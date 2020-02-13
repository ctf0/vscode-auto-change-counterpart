const vscode = require('vscode')
const PACKAGE_NAME = 'auto-change-counterpart'
const debounce = require('lodash.debounce')
const escapeStringRegexp = require('escape-string-regexp')
const Prism = require('prismjs')

let config = {}
let charsList = []
let open = []
let close = []
let visibleTextEditors = []
let prevRemoved = []
let oldConfig = null

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    oldConfig = vscode.workspace.getConfiguration('editor').get('autoClosingBrackets')
    await readConfig()

    // config
    vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration(PACKAGE_NAME)) {
            await readConfig()
        }
    })

    // on start
    for (const editor of vscode.window.visibleTextEditors) {
        saveList(editor.document)
    }

    // on new document
    vscode.window.onDidChangeActiveTextEditor(({ document }) => {
        if (getDocumentIndex(document) < 0) {
            saveList(document)
        }
    })

    // on close
    vscode.workspace.onDidCloseTextDocument((document) => {
        if (document && document.isClosed) {
            removeFromList(document)
        }
    })

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(
            async (e) => {
                if (e) {
                    let editor = vscode.window.activeTextEditor

                    if (!editor) return

                    let { document: aDocument, selections } = editor
                    let { document, contentChanges } = e
                    let added = false

                    if (
                        aDocument == document &&
                        contentChanges.length &&
                        selections.length == 1
                    ) {
                        let change = contentChanges[contentChanges.length - 1]
                        let { rangeLength, text, rangeOffset } = change

                        // select & change
                        // open replace wont work as we should listen to type not changes
                        // if (text && text.length == 1 && close.includes(text)) {
                        //     let replacedChar = getDocumentData(document).content.charAt(rangeOffset)

                        //     if (replacedChar != text) {
                        //         saveRemoved(change, document, replacedChar)
                        //     }
                        // }

                        // remove
                        if (!text && rangeLength == 1) {
                            saveRemoved(change, document)
                        }

                        // replace
                        if (text && text.length == 1 && prevRemoved.length) {
                            await vscode.workspace.getConfiguration().update('editor.autoClosingBrackets', oldConfig, false)
                            added = true

                            resolveReplace(change, editor)
                        }

                        if (added) {
                            updateDocumentData(document)
                        }
                    }
                }
            }
        )
    )
}

function saveRemoved(change, document, deletedChar = null) {
    let { rangeOffset } = change

    deletedChar = deletedChar || getDocumentData(document).content.charAt(rangeOffset)
    let direction = isSupported(deletedChar)
    // console.log('del', deletedChar, range, direction)

    if (direction) {
        saveCharOffset(rangeOffset, deletedChar, direction)

        if (open.includes(deletedChar)) {
            vscode.workspace.getConfiguration().update('editor.autoClosingBrackets', 'never', false)
        }
    }
}

async function resolveReplace(change, editor) {
    let { document } = editor
    let { range, text, rangeOffset } = change
    let deletedCharInfo = getCharByOffset(rangeOffset)
    // console.log('add', text, deletedCharInfo, range)

    if (deletedCharInfo) {
        let { direction } = deletedCharInfo
        let { start } = range
        let { line, character } = start

        switch (direction) {
            case 'toLeft':
                range = new vscode.Range(
                    0,
                    0,
                    line,
                    character
                )
                break
            case 'toRight':
                range = new vscode.Range(
                    line,
                    character,
                    document.lineCount + 1,
                    0
                )
                break
            case 'bi':
                range = new vscode.Range(
                    line,
                    0,
                    line,
                    document.lineAt(line).text.length
                )
                break
        }

        await makeReplacement(editor, change, deletedCharInfo, document.validateRange(range))
    }

    removeCharOffset(rangeOffset)
}

/* Doc List --------------------------------------------------------------------- */
function saveList(document) {
    return visibleTextEditors.push({
        name: document.fileName,
        content: document.getText()
    })
}

function getDocumentIndex(document) {
    return visibleTextEditors.findIndex((e) => e.name == document.fileName)
}

function removeFromList(document) {
    let i = getDocumentIndex(document)

    if (i > -1) {
        return visibleTextEditors.splice(i, 1)
    }
}

const updateDocumentData = debounce(function (document) {
    let i = getDocumentIndex(document)

    return visibleTextEditors[i].content = document.getText()
}, 50)

function getDocumentData(document) {
    return visibleTextEditors.find((e) => e.name == document.fileName)
}

/* Char List --------------------------------------------------------------------- */
function isSupported(char) {
    let res = open.includes(char)
        ? 'toRight'
        : close.includes(char)
            ? 'toLeft'
            : false

    if (charsList[char] == char) {
        res = 'bi'
    }

    if (res) {
        return res
    }

    return res
}

function saveCharOffset(offset, char, direction) {
    return prevRemoved.push({
        offset: offset,
        char: char,
        direction: direction
    })
}

function getCharByOffset(offset) {
    return prevRemoved.find((e) => e.offset == offset)
}

function removeCharOffset(offset) {
    let i = prevRemoved.findIndex((e) => e.offset == offset)

    if (i > -1) {
        return prevRemoved.splice(i, 1)
    }
}

/* replace --------------------------------------------------------------------- */
async function makeReplacement(editor, change, deletedChar, range) {
    let { document } = editor
    let { end, start } = range
    let { text, rangeOffset } = change
    let { char, direction } = deletedChar
    let isLeft = direction == 'toLeft'

    let toReplace = charsList[char] || open.find((k) => charsList[k] === char)
    let replaceWith = charsList[text] || open.find((k) => charsList[k] === text)
    let regex = `${escapeStringRegexp(char)}|${escapeStringRegexp(toReplace)}`
    let oldTxt = getDocumentData(document).content
    let offset
    let pos

    if (direction == 'bi') {
        let lineStart = document.offsetAt(start)
        let lineEnd = document.offsetAt(end)
        let cursorOffset = rangeOffset + 1 - lineStart

        oldTxt = oldTxt.substr(lineStart, lineEnd - lineStart)

        offset = await getCharOffsetBi(oldTxt, document.languageId, cursorOffset, char)

        if (!offset) {
            return false
        }

        pos = document.positionAt(lineStart + offset)
    } else {
        oldTxt = oldTxt.substr(
            isLeft ? 0 : rangeOffset,
            isLeft ? rangeOffset : document.offsetAt(end)
        )

        offset = isLeft
            ? await getCharOffsetLeft(oldTxt, regex, toReplace)
            : await getCharOffsetRight(oldTxt, regex, char)

        pos = isLeft
            ? document.positionAt(offset)
            : document.positionAt(document.offsetAt(start) + offset)
    }

    // test replacement
    // editor.selection = await new vscode.Selection(pos, pos.with(pos.line, pos.character + 1))

    await editor.edit(
        (edit) => edit.replace(
            new vscode.Range(pos, pos.with(pos.line, pos.character + 1)),
            replaceWith
        ),
        { undoStopBefore: true, undoStopAfter: true }
    )
}

async function getCharOffsetRight(txt, regex, open) {
    return new Promise((resolve) => {
        let pos = 0
        let isOpen = 0

        txt.replace(new RegExp(regex, 'g'), (match, offset) => {
            match === open
                ? isOpen++
                : isOpen--

            if (isOpen == 0 && pos == 0) {
                pos = offset
            }
        })

        resolve(pos)
    })
}

async function getCharOffsetLeft(txt, regex, open) {
    return new Promise((resolve) => {
        let pos = []

        txt.replace(new RegExp(regex, 'g'), (match, offset) => {
            if (match == open) {
                pos.push(offset)
            } else {
                pos.pop()
            }
        })

        resolve(pos[pos.length - 1])
    })
}

async function getCharOffsetBi(txt, languageId, cursorOffset, char) {
    return new Promise((resolve) => {
        let lang = Prism.languages[languageId] || Prism.languages['javascript']
        let tokens = Prism.tokenize(txt, lang)
        let end = 0
        let found = null

        for (let i = 0; i < tokens.length; i++) {
            const el = tokens[i]
            let len = el.length
            let start = end
            end += len

            if (end >= cursorOffset) {
                let atStart = start == cursorOffset - 1
                let atEnd = end == cursorOffset

                let regex = atStart
                    ? new RegExp(`${escapeStringRegexp(char)}$`) // get last
                    : atEnd
                        ? new RegExp(`^${escapeStringRegexp(char)}`) // get first
                        : new RegExp(escapeStringRegexp(char), 'g') // todo

                let cont = typeof el == 'object' ? el.content.toString() : el

                // for some fucken reason the regex matches
                // every odd time ex.1st,3rd,5th,etc...
                cont.replace(regex, (match, index) => {
                    found = atStart
                        ? cursorOffset + index - 1
                        : atEnd
                            ? cursorOffset - len
                            : 0
                })

                break
            }
        }

        resolve(found)
    })
}

/* Util --------------------------------------------------------------------- */
async function readConfig() {
    config = await vscode.workspace.getConfiguration(PACKAGE_NAME)
    charsList = config.list
    open = Object.keys(charsList)
    close = Object.values(charsList)
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
}
