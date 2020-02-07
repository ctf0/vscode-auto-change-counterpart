const vscode = require('vscode')
const PACKAGE_NAME = 'auto-change-counterpart'
const debounce = require('lodash.debounce')
const escapeStringRegexp = require('escape-string-regexp')

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

                    if (aDocument == document && contentChanges.length && selections.length == 1) {
                        let change = contentChanges[contentChanges.length - 1]
                        let { range, rangeLength, text, rangeOffset } = change

                        // remove
                        if (!text && rangeLength == 1) {
                            let deletedChar = getDocumentData(document).content.charAt(rangeOffset)
                            let direction = isSupported(deletedChar)
                            // console.log('del', deletedChar, range, direction)

                            if (direction) {
                                saveCharOffset(rangeOffset, deletedChar, direction)

                                if (open.includes(deletedChar)) {
                                    vscode.workspace.getConfiguration().update('editor.autoClosingBrackets', 'never', false)
                                }
                            }
                        }

                        // replace
                        if (text) {
                            await vscode.workspace.getConfiguration().update('editor.autoClosingBrackets', oldConfig, false)
                            added = true

                            if (text.length == 1 && prevRemoved.length) {
                                let deletedCharInfo = getCharByOffset(rangeOffset)
                                // console.log('add', text, deletedCharInfo, range)

                                if (deletedCharInfo) {
                                    let { direction, char } = deletedCharInfo

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
    let oldTxt
    let offset
    let pos

    if (direction == 'bi') {
        regex = `${escapeStringRegexp(char)}|${escapeStringRegexp(replaceWith)}`
        oldTxt = document.getText(range)

        offset = await getCharOffsetBi(oldTxt, replaceWith, regex)
        pos = document.positionAt(document.offsetAt(start) + offset)
    } else {
        regex = `${escapeStringRegexp(char)}|${escapeStringRegexp(toReplace)}`
        oldTxt = getDocumentData(document)
            .content
            .substr(
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
    // editor.selection = new vscode.Selection(pos, pos.with(pos.line, pos.character + 1))

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

async function getCharOffsetBi(txt, replacement, regex) {
    return new Promise((resolve) => {
        let res = {}
        let arr = []
        txt.replace(new RegExp(regex, 'g'), (match, offset) => {
            arr.push({
                match: match,
                offset: offset
            })
        })

        let first = arr[0]
        let last = arr[arr.length - 1]
        let me = arr.findIndex((e) => e.match == replacement)
        let direction = me > arr.length / 2
            ? 'toLeft'
            : 'toRight'

        if (arr[me] == first) { // am first, get last
            resolve(last.offset)
        } else if (arr[me] == last) { // am last, get first
            resolve(first.offset)
        }

        switch (direction) {
            case 'toLeft':
                res = arr[me - 1]
                break
            case 'toRight':
                res = arr[me + 1]
                break
        }

        resolve(res.offset)
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
