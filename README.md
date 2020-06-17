# babel-plugin-lazy-action-creator

# problem:
We used to define mapDispatchToProps
using syntax like
```
const mapdispatchToProps = {
  multiplication,
  addition,
  subtraction,
}
```
or
```
const mapdispatchToProps= (dispatch) => {
  return {
    multiplication2: (a, b) => {
      return dispatch(multiplication(a, b))
    },
    addition: (arg, ...rest) => dispatch(addition(arg, ...rest)),
    subtraction: (a, b) => dispatch(subtraction(a, b)),
  }
}
```

then in the bundle all the code related to these action will attached into bundle.

But the action definition may not required for the first load time, it may required for later upon use interaction.

so we can do lazy laod this function when required, then systax will be like
```
const mapdispatchToProps= (dispatch) => {
  return {
    multiplication: (a, b) => import("./action-multiplication.js")
      .then(({default: multiplication})=>{
        return dispatch(multiplication(a, b))
      },

    addition: (arg, ...rest) =>import("./action-addition.js")
      .then(({default: addition})=>dispatch(addition(arg, ...rest))),

    subtraction: (arg1, arg2) =>import("./action-subtraction.js")
      .then(({default: subtraction})=>dispatch(subtraction(arg1, arg2)))
  }
}
```
Now if we bundle this, then we will get four chunks,
  -  one for the code of the file
  -  action-multiplication.js
  -   for action-addition.js
  -  for action-subtraction.js

# usage
```
  npm i babel-plugin-lazy-action-creator
```
and add .babelrc
```
"plugins": [
  "babel-plugin-lazy-action-creator",
  ...
]
```
