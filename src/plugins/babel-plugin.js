const METHODS = new Set(["log", "info", "warn", "error", "debug", "trace"]);

function propertyName(node) {
  if (!node) {
    return null;
  }

  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "StringLiteral" || node.type === "NumericLiteral") {
    return String(node.value);
  }

  if (node.type === "PrivateName" && node.id?.name) {
    return `#${node.id.name}`;
  }

  return null;
}

function memberExpressionName(node) {
  if (!node) {
    return null;
  }

  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "ThisExpression") {
    return "this";
  }

  if (node.type === "MemberExpression") {
    const objectName = memberExpressionName(node.object);
    const keyName = propertyName(node.property);

    if (objectName && keyName) {
      return `${objectName}.${keyName}`;
    }

    return keyName || objectName;
  }

  return null;
}

function inferFunctionName(path) {
  const functionPath = path.getFunctionParent();
  if (!functionPath) {
    return null;
  }

  const { node, parentPath } = functionPath;

  if (node.id?.name) {
    return node.id.name;
  }

  if (functionPath.isClassMethod() || functionPath.isClassPrivateMethod()) {
    const methodName = propertyName(node.key);
    const className = functionPath.parentPath?.parentPath?.node?.id?.name || null;
    if (className && methodName) {
      return `${className}.${methodName}`;
    }

    return methodName;
  }

  if (functionPath.isObjectMethod()) {
    const methodName = propertyName(node.key);
    const objectName = memberExpressionName(parentPath?.parentPath?.node?.id) || null;

    if (objectName && methodName) {
      return `${objectName}.${methodName}`;
    }

    return methodName;
  }

  if (parentPath?.isVariableDeclarator()) {
    return memberExpressionName(parentPath.node.id);
  }

  if (parentPath?.isAssignmentExpression()) {
    return memberExpressionName(parentPath.node.left);
  }

  if (parentPath?.isObjectProperty() || parentPath?.isClassProperty() || parentPath?.isClassPrivateProperty()) {
    return propertyName(parentPath.node.key);
  }

  return null;
}

export default function xlogBabelPlugin(babel) {
  const t = babel.types;

  return {
    name: "xlog-babel-plugin",
    visitor: {
      Program: {
        enter(programPath, state) {
          state.xlogHelperId = programPath.scope.generateUidIdentifier("xlogConsole");
          state.xlogHasUsage = false;
        },
        exit(programPath, state) {
          if (!state.xlogHasUsage) {
            return;
          }

          programPath.unshiftContainer(
            "body",
            t.importDeclaration(
              [
                t.importSpecifier(
                  t.identifier(state.xlogHelperId.name),
                  t.identifier("xlogConsole")
                )
              ],
              t.stringLiteral("xlog-cli/runtime")
            )
          );
        }
      },

      CallExpression(path, state) {
        const callee = path.get("callee");

        if (!callee.isMemberExpression()) {
          return;
        }

        if (!callee.get("object").isIdentifier({ name: "console" })) {
          return;
        }

        if (!callee.get("property").isIdentifier()) {
          return;
        }

        const method = callee.get("property").node.name;
        if (!METHODS.has(method)) {
          return;
        }

        const loc = path.node.loc && path.node.loc.start ? path.node.loc.start : null;
        const filename =
          state.file.opts.filenameRelative || state.file.opts.filename || "unknown-file";
        const functionName = inferFunctionName(path);

        const metaProperties = [
          t.objectProperty(t.identifier("file"), t.stringLiteral(filename)),
          t.objectProperty(t.identifier("line"), t.numericLiteral(loc ? loc.line : 0)),
          t.objectProperty(t.identifier("column"), t.numericLiteral(loc ? loc.column + 1 : 0))
        ];

        if (functionName) {
          metaProperties.push(
            t.objectProperty(t.identifier("functionName"), t.stringLiteral(functionName))
          );
        }

        const metaObject = t.objectExpression(metaProperties);

        state.xlogHasUsage = true;

        path.replaceWith(
          t.callExpression(t.identifier(state.xlogHelperId.name), [
            t.stringLiteral(method),
            metaObject,
            ...path.node.arguments
          ])
        );
      }
    }
  };
}
