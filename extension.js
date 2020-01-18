const vscode = require('vscode')
const PACKAGE_NAME = 'auto-change-counterpart'
const debounce = require('lodash.debounce')
const escapeStringRegexp = require('escape-string-regexp')

let config = {}
let charsList = []
let visibleTextEditors = []
let prevRemoved = []

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
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

                    let { document: aDocument } = editor
                    let { document, contentChanges } = e
                    let added = false

                    if (aDocument == document && contentChanges.length) {
                        for (let i = 0; i < contentChanges.length; i++) {
                            let change = contentChanges[i]
                            let { range, rangeLength, text, rangeOffset } = change

                            // remove
                            if (!text && rangeLength == 1) {
                                let deletedChar = getDocumentData(document).content.charAt(rangeOffset)
                                let group = isSupported(deletedChar)
                                // console.log('del', deletedChar, range, group)

                                if (group) {
                                    saveCharOffset(rangeOffset, deletedChar, group)
                                }
                            }

                            // replace
                            if (text) {
                                added = true

                                if (text.length == 1 && prevRemoved.length) {
                                    let text = document.lineAt(range.start.line).text
                                    let deletedChar = getCharByOffset(rangeOffset)
                                    // console.log('add', text, deletedChar, range)

                                    if (deletedChar) {
                                        range = new vscode.Range(
                                            range.start.line,
                                            0,
                                            range.start.line,
                                            text.length
                                        )

                                        if (!range.isEmpty) {
                                            await makeReplacement(editor, change, deletedChar, range, text)
                                        }
                                    }

                                    removeCharOffset(rangeOffset)
                                }
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
    let res = null

    for (const item of charsList) {
        if (Object.keys(item.chars).includes(char)) {
            res = item
            break
        }
    }

    return res
}

function saveCharOffset(offset, char, group) {
    return prevRemoved.push({
        offset: offset,
        char: char,
        group: group
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
async function makeReplacement(editor, change, deletedChar, range, lineText) {
    let { text } = change
    let { char, group } = deletedChar
    let { chars } = group
    let toReplace = chars[char]
    let replaceWith = chars[text]
    let replaceDone = false

    let moveBy = await getCharDiff(lineText, toReplace, replaceWith)

    // console.log(moveBy)

    await editor.edit(
        (edit) => edit.replace(
            range,
            lineText.replace(new RegExp(escapeStringRegexp(toReplace), 'g'), (match) => {
                if (moveBy == 0 && !replaceDone) {
                    replaceDone = true

                    return replaceWith
                } else {
                    if (!replaceDone) {
                        moveBy--
                    }

                    return match
                }
            })
        )
    )
}

async function getCharDiff(txt, lookFor, replacement) {
    return new Promise((resolve) => {
        let count = 0
        let arr = txt.match(
            new RegExp(`${escapeStringRegexp(lookFor)}|${escapeStringRegexp(replacement)}`, 'g')
        )

        for (let i = 0; i < arr.length; i++) {
            const me = arr[i]

            if (me == replacement) {
                if (i <= 1) { // first or second
                    count = 0
                } else if (i == arr.length - 2) { // before last
                    count = i
                } else if (i == arr.length - 1) { // last
                    count = i - 1
                }

                break
            }
        }

        resolve(count)
    })
}

/* Util --------------------------------------------------------------------- */
async function readConfig() {
    config = await vscode.workspace.getConfiguration(PACKAGE_NAME)
    charsList = config.list
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
}
