## How It Works

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

> keep in mind that the extension works in that **exact** order,
>
> for example in step **#2** if you added any other character than the configured ones, it will be hard for the extension to keep track & no changes will be made.

### Config

- "toRight" means you want to change the counterpart to right hand on the text "cursor to end of line"
- "toLeft" means you want to change the counterpart to left hand on the text "cursor to start of line"
- "bi" search in both ways "the whole line"

### Notes

- same counterpart chars ex.(`,',") have to be either`left`or`right` as we cant id if the change should be made to which direction
