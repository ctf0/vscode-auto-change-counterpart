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

### # Config

- "toRight" means you want to change the counterpart to right hand on the text "cursor to end of line"
- "toLeft" means you want to change the counterpart to left hand on the text "cursor to start of line"
- "bi" search in both ways "the whole line"

### # Notes

- sadly no api to get the scope, so for now the changes have to be made on the same line
