import * as ts from 'typescript';
import {
	createPrinter,
	createSourceFile,
	EmitHint,
	factory,
	NewLineKind,
	ScriptKind,
	ScriptTarget,
	SyntaxKind,
} from 'typescript';

type ReplacementArguments = Readonly<{
	text: string;
	receivedKind: 'boolean' | 'number' | 'string';
	expectedKind: 'boolean' | 'number' | 'string';
}>;

const regexp = /^(-|\+)?[0-9]+(.[0-9]+)?$/;

export const buildReplacement = ({
	expectedKind,
	receivedKind,
	text,
}: ReplacementArguments): string => {
	const surroundedBySingleQuote = text.startsWith("'") && text.endsWith("'");
	const surroundedByDoubleQuote = text.startsWith('"') && text.endsWith('"');

	if (expectedKind === 'boolean') {
		if (receivedKind === 'string') {
			if (surroundedBySingleQuote || surroundedByDoubleQuote) {
				const value = text.slice(1, text.length - 1);

				if (value === 'false' || value === 'true') {
					return value;
				}
			}
		}

		if (receivedKind === 'number') {
			if (text === '0') {
				return 'false';
			}

			if (regexp.test(text)) {
				return 'true';
			}
		}

		return `Boolean(${text})`;
	}

	if (expectedKind === 'number') {
		if (receivedKind === 'string') {
			if (surroundedBySingleQuote || surroundedByDoubleQuote) {
				const value = text.slice(1, text.length - 1);

				if (value.length === 0) {
					return '0';
				}

				if (regexp.test(value)) {
					return value;
				}
			}
		}

		if (receivedKind === 'boolean') {
			if (text === 'false') {
				return '0';
			}

			if (text === 'true') {
				return '1';
			}
		}

		return `Number(${text})`;
	}

	if (expectedKind === 'string') {
		if (receivedKind === 'boolean') {
			if (text === 'false' || text === 'true') {
				return `'${text}'`;
			}
		}

		if (regexp.test(text)) {
			return `'${text}'`;
		}

		return `String(${text})`;
	}

	return text;
};

export const buildTs2769ObjectAssignReplacement = (
	callExpressionArguments: ReadonlyArray<ts.Expression>,
): string => {
	const firstArgument = callExpressionArguments[0];

	if (!firstArgument) {
		throw new Error('The call expression must have at least one argument');
	}

	const callExpression = factory.createCallExpression(
		factory.createPropertyAccessExpression(
			factory.createIdentifier('Object'),
			factory.createIdentifier('assign'),
		),
		undefined,
		[
			factory.createObjectLiteralExpression([], false),
			...callExpressionArguments,
		],
	);

	const binaryExpression = factory.createBinaryExpression(
		firstArgument,
		factory.createToken(SyntaxKind.EqualsToken),
		callExpression,
	);

	const file = createSourceFile(
		'index.ts',
		'',
		ScriptTarget.Latest,
		false,
		ScriptKind.TS,
	);

	const printer = createPrinter({ newLine: NewLineKind.LineFeed });

	return printer.printNode(EmitHint.Expression, binaryExpression, file);
};
