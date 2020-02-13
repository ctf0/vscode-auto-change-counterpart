# Auto Change Counterpart

i made this because i wanted to change between **braces,quotes,etc..** as fluent as possible without needing to remember a shortcut that runs a command to do so

## # How It Works

0. original

```js
"some text"
```

1. remove `"`

```js
"some text
```

2. add a new character `'`

```js
"some text'
```

3. extension will do its work

```js
'some text'
```

> keep in mind that the extension works in that **exact** order, for example
>
> - in step **#2** if you added any other character than the configured ones, extension wont be able to keep track of the removed character position & no changes will be made.
> - if you selected a text and replaced it with one of the configured character, also wont work
>
> you have to first do a removal using `backspace/delete` then add the new character

## Notes

- bi direction characters ex.`", ', ~, etc..'` search on the same line only
- changes are applied for single selection only to avoid unexpected behavior
