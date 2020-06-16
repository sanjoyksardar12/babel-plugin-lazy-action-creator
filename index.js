"use strict";

exports.__esModule = true;

exports.default = function ({ types: t }) {
  return {
    name: "babel-plugin-lazy-action-creator",
    visitor: {
      CallExpression(path) {

        if (path.node.callee.name !== "connect") {
          return;
        }
        if (isDisableFile(path)) {
          return;
        }
        console.log("a");
        console.log("----> ",path.hub.file.opts.filename);
        if(path.hub.file.opts.filename.includes("node_module")){
          return;
        }
        const mapDispatchToPropsNode = getMapDispatchToPropsNode(path);
        if(!mapDispatchToPropsNode){
          return;
        }

        let isMapDispatchToPropsObject = false;
        debugger
        let {
          returnStatement,
          aMDTPDecl,
          isConnectItselfContainingDeclaration
        } = getReturnStatement(path, mapDispatchToPropsNode)||{};  //ObjectExpression|ArrowFunctionExpression|FunctionExpression
        if(!returnStatement){
          return;
        }
        if (returnStatement.node.type === "ObjectExpression") {
          isMapDispatchToPropsObject = true;
        }
        if (!isMapDispatchToPropsObject && returnStatement.node.argument.type !== "ObjectExpression") {
          return;
        }
        modifyReturnStatetmentWithDynamicImport(returnStatement, t, isMapDispatchToPropsObject, path);
        updateNodePath(isMapDispatchToPropsObject, isConnectItselfContainingDeclaration, t, aMDTPDecl, path);
      }
    }
  };
};


const SPECIFIER_TYPES = {
  ImportDefaultSpecifier: "ImportDefaultSpecifier",
  ImportNamespaceSpecifier: "ImportNamespaceSpecifier",
  ImportSpecifier: "ImportSpecifier"
};
const COMMENT_TYPE_REGEX = /\s*babel\s+lazy\-action\-creator\:\s+\"disable\"\s*/;

function updateNodePath(isMapDispatchToPropsObject, isConnectItselfContainingDeclaration, t, aMDTPDecl, path) {
  if (isMapDispatchToPropsObject && !isConnectItselfContainingDeclaration) {
    const returnStatement = t.returnStatement(aMDTPDecl.node.init);
    const BlockStatement = t.blockStatement([returnStatement]);
    const arrowFunction = t.arrowFunctionExpression(
      [t.identifier("dispatch")],
      BlockStatement);
    const mdp = t.variableDeclarator(aMDTPDecl.node.id, arrowFunction);
    aMDTPDecl.replaceWith(mdp);
  }
  else if (isMapDispatchToPropsObject && isConnectItselfContainingDeclaration) {
    const arrowFuncBody = t.arrowFunctionExpression([t.identifier("dispatch")], path.node.arguments[1]);
    const duplicateConnect = t.callExpression(t.identifier("connect"), [path.node.arguments[0], arrowFuncBody]);
    path.parentPath.node[path.key] = duplicateConnect;
  }
}

function isDisableFile(program) {
  for (let i = 0; program.node.body && i < program.node.body.length; i++) {
    const bodyElement = program.node.body[i];
    for (let j = 0; bodyElement.leadingComments && j < bodyElement.leadingComments.length; j++) {
      let comment = bodyElement.leadingComments[j];
      const { type, value } = comment;
      if (type === "CommentBlock" && COMMENT_TYPE_REGEX.test(value.trim())) {
        return true;
      }
    }
  };
}

function getReturnStatementProperties(returnStatement, isMapDispatchToPropsObject) {
  if (!isMapDispatchToPropsObject) {
    return returnStatement.get("argument").get("properties");
  }
  return returnStatement.get("properties");
}
function calculateOriginalActionNameAndSpecifier(returnArgument) { // ArrowFunctionExpression|FunctionExpression|Identifier|MemberExpression
  let originalActionName, originalActionSpecifier;
  switch (returnArgument.node.type) {
    case "Identifier": {
      originalActionName = returnArgument.node.name;
      originalActionSpecifier = returnArgument.node.name;
      break;
    }
    case "MemberExpression": {
      originalActionName = returnArgument.node.object.name;
      originalActionSpecifier = returnArgument.node.property.name;
      break;
    }
    case "FunctionExpression":
    case "ArrowFunctionExpression": {
      returnArgument.traverse({
        CallExpression(dispatchNode) {
          //considering only one dispatch method will be in the callback
          if (dispatchNode.node.callee.name !== "dispatch") {
            return;
          }
          const actionCallNode = dispatchNode.get("arguments")[0];
          const { callee } = actionCallNode.node;
          if (callee.type === "Identifier") {
            originalActionName = callee.name;
          } else if (callee.type === "MemberExpression") {
            originalActionName = callee.object.name;
            originalActionSpecifier = callee.property.name;
          }
        }
      });
      break;
    }
    default:
  }
  return {
    originalActionName,
    originalActionSpecifier
  }
}
function getOriginalParams(t, prop, isMapDispatchToPropsObject) {
  if (isMapDispatchToPropsObject) {
    return t.restElement(t.identifier("rest")); //passing reset operator for object type
  }
  //console.log("prop", prop);
  return prop.node.value.params;

}


function modifyReturnStatetmentWithDynamicImport(returnStatement, t, isMapDispatchToPropsObject, path) {
  const properties = getReturnStatementProperties(returnStatement, isMapDispatchToPropsObject); // [ObjectProperty(key, value)]
  for (let i = 0; i < properties.length; i++) {
    let prop = properties[i]; //ObjectProperty(key, value)
    if (isPluginDisableForProperty(prop)) {
      continue;
    }
    const returnArgument = prop.get("value"); //ArrowFunctionExpression|FunctionExpression|Identifier|MemberExpression
    let {
      originalActionName,
      originalActionSpecifier
    } = calculateOriginalActionNameAndSpecifier(returnArgument);

    const actionNameAsProp = prop.node.key.name;
    const {
      importStatement,
      specifierType,
      specifier,
      namedImport
    } = getImportStatement(returnStatement, originalActionName);

    const originalParams = getOriginalParams(t, prop, isMapDispatchToPropsObject);

    const modifiedFunction = constructLazyActionCreator(
      t,
      returnStatement,
      originalParams,
      prop,
      originalActionName,
      importStatement,
      specifierType,
      specifier,
      originalActionSpecifier,
      namedImport,
      isMapDispatchToPropsObject,
    );

    //console.log("modifiedFunction===", modifiedFunction, actionNameAsProp)
    cleanUpImportStatement(importStatement, originalActionName);
    //let prog = path.findParent((p) => p.isProgram());
    //console.log("program===", prog);
    //prog.node.body.push(modifiedFunction);
    if (isMapDispatchToPropsObject) {
      prop.node.value = modifiedFunction

    } else {
      returnStatement.traverse({
        ObjectExpression(innerPath) {
          const objectProperty = t.objectProperty(t.identifier(actionNameAsProp), modifiedFunction);
          innerPath.node.properties[i] = objectProperty;
        }
      });
    }

  }
}

function isPluginDisableForProperty(path) {
  return (path.node.leadingComments || []).filter(({ type, value }) =>
    type === "CommentBlock" && COMMENT_TYPE_REGEX.test(value)).length;
}

function constructLazyActionCreator(
  t,
  path,
  originalParams,
  prop,
  originalActionName,
  importStatement,
  specifierType,
  specifier,
  originalActionSpecifier,
  namedImport,
  isMapDispatchToPropsObject
) {

  const filename = importStatement.node.source.value;
  const importState = t.memberExpression(t.callExpression(t.import(), [t.stringLiteral(filename)]), t.identifier("then"));
  // let prog = path.findParent((p) => p.isProgram());
  // prog.node.body.push(importState);
  let objectState;
  let keyname = originalActionName;
  if (specifierType === "ImportSpecifier") {
    keyname = namedImport;
  } else if (specifierType === "ImportDefaultSpecifier") {
    keyname = "default";
  }
  if (specifierType === "ImportNamespaceSpecifier") {
    objectState = t.identifier(originalActionName);
  } else {
    objectState = t.objectPattern([t.objectProperty(t.identifier(keyname), t.identifier(originalActionName))]);
  }

  const arrowFuncBody = getActionDispatcherBody(
    t,
    prop,
    isMapDispatchToPropsObject,
    originalParams,
    originalActionName,
    originalActionSpecifier,
    specifierType
  );

  const args = t.arrowFunctionExpression([objectState], arrowFuncBody);
  const returnStatement = t.callExpression(importState, [args]);
  const params = isMapDispatchToPropsObject ? [originalParams] : originalParams;
  const outerFunction = t.arrowFunctionExpression(params, returnStatement);
  // let prog = path.findParent((p) => p.isProgram());
  //prog.node.body.push(outerFunction);
  return outerFunction;
}

function getActionDispatcherBody(
  t,
  prop,
  isMapDispatchToPropsObject,
  originalParams,
  originalActionName,
  originalActionSpecifier,
  specifierType
) {
  if (!isMapDispatchToPropsObject) {
    return prop.node.value.body;
  }
  let functionName = t.identifier(originalActionName);
  if (specifierType === "ImportNamespaceSpecifier") {
    functionName = t.memberExpression(functionName, t.identifier(originalActionSpecifier))
  }
  //generating---> dispatch(addition(...rest))
  const customDispatchMethod = t.callExpression(
    t.identifier("dispatch"),
    [
      t.callExpression(functionName,
        [t.spreadElement(t.identifier(originalParams.argument.name))])
    ]
  );
  return customDispatchMethod;
}


function cleanUpImportStatement(importStatement, actionName) {
  //stop traversal as soon as action name is matched
  importStatement.traverse({
    ImportDefaultSpecifier(specifierPath) {
      removeSpecifierHandler(importStatement, specifierPath, actionName);
    },
    ImportSpecifier(specifierPath) {
      removeSpecifierHandler(importStatement, specifierPath, actionName);
    },
    ImportNamespaceSpecifier(specifierPath) {
      removeSpecifierHandler(importStatement, specifierPath, actionName);
    }
  });
}

function removeSpecifierHandler(importStatement, specifierPath, actionName) {
  if (specifierPath.node.local.name === actionName) {
    if (importStatement.node.specifiers && importStatement.node.specifiers.length === 1) {
      importStatement.remove();
    } else {
      specifierPath.remove();
    }
  }
}
function getImportStatement(path, requiredSpecifierName) {
  const program = path.findParent((p) => p.isProgram());
  const programBody = program.get("body");

  const importDeclarations = programBody.filter((path) => path.node.type === "ImportDeclaration");

  let importStatement, specifierType, matchedSpecifier, namedImport;

  for (let i = 0; i < importDeclarations.length; i++) {
    const importDeclaration = importDeclarations[i];
    const specifiersNode = importDeclaration.node.specifiers;

    if (specifiersNode && specifiersNode.length) {
      for (let i = 0; i < specifiersNode.length; i++) {
        const specifier = specifiersNode[i];
        const { specifierType: specType, status, namedImport: originalNamedImport } = isSpecifierContainRequiredSpecifier(specifier, requiredSpecifierName);
        if (status) {
          importStatement = importDeclaration;
          specifierType = specType;
          matchedSpecifier = specifier;
          namedImport = originalNamedImport;
          break;
        }
      }
    }
  }
  return {
    importStatement,
    specifierType,
    specifier: matchedSpecifier,
    namedImport: namedImport
  };
}

function isSpecifierContainRequiredSpecifier(specifier, requiredSpecifierName) {
  const { local, imported } = specifier;
  let status = false;
  switch (specifier.type) {
    case SPECIFIER_TYPES.ImportDefaultSpecifier:
    case SPECIFIER_TYPES.ImportNamespaceSpecifier:
    case SPECIFIER_TYPES.ImportSpecifier: {
      status = local.name === requiredSpecifierName;
      break;
    }
    default: {
      status = false;
    }
  }
  return {
    status,
    specifierType: specifier.type,
    namedImport: imported ? imported.name : null
  };
}
//refactor this code using switch
function getReturnStatement(path, mapDispatchToPropsNode) {
  if(mapDispatchToPropsNode.node.type === "ObjectExpression"){
    return {
      returnStatement: mapDispatchToPropsNode,
      isConnectItselfContainingDeclaration: true,
      aMDTPDecl: undefined
    };
  }else if(mapDispatchToPropsNode.node.type === "Identifier"){
    const mapDispatchToPropsName = mapDispatchToPropsNode.node.name;
    const program = getParentProgram(path);
    let aMDTPDecl = getACtualMapDispToPropsDeclaration({ program, mapDispatchToPropsName });


    let returnStatement;
    let declarator = aMDTPDecl.get("init").node? aMDTPDecl.get("init"): aMDTPDecl.get("body");
    if (declarator.node.type === "ObjectExpression") {
      return {
        returnStatement: declarator,
        isConnectItselfContainingDeclaration: false,
        aMDTPDecl: aMDTPDecl
      };
    }else { //add conditions
      let outerReturn = false;
      declarator.traverse({
        ReturnStatement(path) {
          if (outerReturn) {
            return;
          }
          returnStatement = path;
          outerReturn = true;
        }
      });
      outerReturn = false;
      return {
        returnStatement: returnStatement,
        isConnectItselfContainingDeclaration: false,
        aMDTPDecl: aMDTPDecl
      };
    }
  }
}



function getACtualMapDispToPropsDeclaration({ program, mapDispatchToPropsName }) {
  let actualMapDispToPropsDeclaration;
  const body = program.node.body;
  const rootLevelVariableDeclaration = program.get("body").filter((child) => {
    if (child.node.type === "VariableDeclaration" || child.node.type === "FunctionDeclaration") {
      return true;
    }
  });
  for (let i = 0; i < rootLevelVariableDeclaration.length; i++) {
    const variableDeclaration = rootLevelVariableDeclaration[i];

    if (variableDeclaration.node.type === "VariableDeclaration") {
      const declarations = variableDeclaration.get("declarations");
      for (let j = 0; j < declarations.length; j++) {
        const declaration = declarations[j];
        if (declaration.node.id.name === mapDispatchToPropsName) {
          //add regex
          //actualMapDispToPropsDeclaration = declaration;
          return declaration;
          break;
        }
      }
    } else if (variableDeclaration.node.type === "FunctionDeclaration") {
      if(variableDeclaration.node.id.name===mapDispatchToPropsName){
        return variableDeclaration;
      }
    }
  }
  // return actualMapDispToPropsDeclaration;
}


function getParentProgram(path) {
  return path.findParent(p => p.isProgram());
}


//path=> connect statement
//return=>return second params name in connect statement as node
function getMapDispatchToPropsNode(path) {
  const args = path.get("arguments");
  if (args.length > 1) {
    return args[1];
  }
  return undefined;
}


