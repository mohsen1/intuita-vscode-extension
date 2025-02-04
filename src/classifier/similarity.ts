import * as ts from 'typescript';
import { buildHash } from '../utilities';

export const getWords = (rootNode: ts.Node): ReadonlyArray<string> => {
	const words: string[] = [];

	const appendWords = (node: ts.Node, level: number) => {
		let hash: string;

		if (
			ts.isIdentifier(node) ||
			ts.isNumericLiteral(node) ||
			ts.isStringLiteral(node)
		) {
			hash = buildHash(`${node.kind},${level},${node.text}`);
		} else {
			hash = buildHash(`${node.kind},${level}`);
		}

		words.push(hash);

		for (const childNode of node.getChildren()) {
			appendWords(childNode, level + 1);
		}
	};

	appendWords(rootNode, 0);

	return words;
};

export const buildBagOfWords = (
	words: ReadonlyArray<string>,
): ReadonlyMap<string, number> => {
	const bagOfWords = new Map<string, number>();

	for (const word of words) {
		let count = bagOfWords.get(word) ?? 0;

		++count;

		bagOfWords.set(word, count);
	}

	return bagOfWords;
};

export const normalizeBagsOfWords = (
	leftBagOfWords: ReadonlyMap<string, number>,
	rightBagOfWords: ReadonlyMap<string, number>,
): [ReadonlyArray<number>, ReadonlyArray<number>] => {
	const keySet = new Set<string>();

	leftBagOfWords.forEach((_, key) => {
		keySet.add(key);
	});

	rightBagOfWords.forEach((_, key) => {
		keySet.add(key);
	});

	const leftVector: number[] = [];
	const rightVector: number[] = [];
	let i = 0;

	for (const key of keySet.keys()) {
		leftVector[i] = leftBagOfWords.get(key) ?? 0;
		rightVector[i] = rightBagOfWords.get(key) ?? 0;

		++i;
	}

	return [leftVector, rightVector];
};

export const buildDotProduct = (
	leftVector: ReadonlyArray<number>,
	rightVector: ReadonlyArray<number>,
): number =>
	leftVector.reduce(
		(prev, curr, index) => (prev += curr * (rightVector[index] ?? 0)),
	);

export const buildEuclideanNorm = (vector: ReadonlyArray<number>) => {
	const sums = vector.reduce((prev, curr) => (prev += curr ** 2), 0);

	return Math.sqrt(sums);
};

export const calculateCosineSimilarity = (
	leftVector: ReadonlyArray<number>,
	rightVector: ReadonlyArray<number>,
) => {
	return (
		buildDotProduct(leftVector, rightVector) /
		buildEuclideanNorm(leftVector) /
		buildEuclideanNorm(rightVector)
	);
};

export const calculateSimilarity = (
	leftNode: ts.Node,
	rightNode: ts.Node,
): number => {
	const leftWords = getWords(leftNode);
	const rightWords = getWords(rightNode);

	const leftBagOfWords = buildBagOfWords(leftWords);
	const rightBagOfWords = buildBagOfWords(rightWords);

	const [leftVector, rightVector] = normalizeBagsOfWords(
		leftBagOfWords,
		rightBagOfWords,
	);

	return calculateCosineSimilarity(leftVector, rightVector);
};
