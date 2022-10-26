import { join } from 'node:path';
import {
	commands,
	Diagnostic,
	DiagnosticCollection,
	DiagnosticSeverity,
	Event,
	EventEmitter,
	MarkdownString,
	Position,
	ProviderResult,
	Range,
	TreeDataProvider,
	TreeItem,
	TreeItem2,
	TreeItemCollapsibleState,
	TreeView,
	Uri,
	window,
	workspace,
} from 'vscode';
import {
	assertsNeitherNullOrUndefined,
	calculateCharacterIndex,
	IntuitaPosition,
	isNeitherNullNorUndefined,
} from '../utilities';
import { JobManager } from './jobManager';
import { buildFileUri, buildJobUri } from './intuitaFileSystem';
import { Message, MessageBus, MessageKind } from './messageBus';
import { CaseWithJobHashes } from '../cases/types';
import {
	CaseElement,
	DiagnosticElement,
	Element,
	ElementHash,
	FileElement,
	RootElement,
} from '../elements/types';
import { buildDiagnosticElement } from '../elements/buildDiagnosticElement';
import { buildFileElement } from '../elements/buildFileElement';
import { getFirstDiagnosticElement } from '../elements/getFirstDiagnosticElement';
import { buildCaseElement } from '../elements/buildCaseElement';
import { Job, JobHash, JobKind } from '../jobs/types';
import type { CaseManager } from '../cases/caseManager';

export const ROOT_ELEMENT_HASH: ElementHash = '' as ElementHash;

export const calculateCharacterDifference = (
	job: Job,
	position: IntuitaPosition,
): number => {
	if (job.kind !== JobKind.moveTopLevelNode) {
		return 0;
	}

	const characterIndex = calculateCharacterIndex(
		job.separator,
		job.lengths,
		position[0],
		position[1],
	);

	const topLevelNodeIndex = job.topLevelNodes.findIndex((topLevelNode) => {
		return (
			topLevelNode.triviaStart <= characterIndex &&
			characterIndex <= topLevelNode.triviaEnd
		);
	});

	const topLevelNode = job.topLevelNodes[topLevelNodeIndex] ?? null;

	assertsNeitherNullOrUndefined(topLevelNode);

	return characterIndex - topLevelNode.triviaStart;
};

const buildDiagnostic = ({
	kind,
	title,
	range: intuitaRange,
}: Job): Diagnostic => {
	const startPosition = new Position(intuitaRange[0], intuitaRange[1]);

	const endPosition = new Position(intuitaRange[2], intuitaRange[3]);

	const vscodeRange = new Range(startPosition, endPosition);

	const diagnostic = new Diagnostic(
		vscodeRange,
		title,
		DiagnosticSeverity.Information,
	);

	diagnostic.code = kind.valueOf();
	diagnostic.source = 'intuita';

	return diagnostic;
};

const getElementIconBaseName = (kind: Element['kind']): string => {
	switch (kind) {
		case 'CASE':
			return 'coderepair.svg';
		case 'FILE':
			return 'ts2.svg';
		default:
			return 'bluelightbulb.svg';
	}
};

export class IntuitaTreeDataProvider implements TreeDataProvider<ElementHash> {
	public readonly eventEmitter = new EventEmitter<void>();
	public readonly onDidChangeTreeData: Event<void>;
	protected readonly _elementMap = new Map<ElementHash, Element>();
	protected readonly _childParentMap = new Map<ElementHash, ElementHash>();
	protected readonly _activeJobHashes = new Set<JobHash>();
	protected _reveal: TreeView<ElementHash>['reveal'] | null = null;

	public constructor(
		protected readonly _caseManager: CaseManager,
		protected readonly _messageBus: MessageBus,
		protected readonly _jobManager: JobManager,
		protected readonly _diagnosticCollection: DiagnosticCollection,
	) {
		this.onDidChangeTreeData = this.eventEmitter.event;

		this._messageBus.subscribe((message) => {
			if (message.kind === MessageKind.updateInternalDiagnostics) {
				setImmediate(async () => {
					await this._onUpdateInternalDiagnostics(message);
				});
			}
		});
	}

	public setReveal(reveal: TreeView<ElementHash>['reveal']) {
		this._reveal = reveal;
	}

	public getParent(elementHash: ElementHash): ProviderResult<ElementHash> {
		return this._childParentMap.get(elementHash);
	}

	public getChildren(
		elementHash: ElementHash | undefined,
	): ProviderResult<ElementHash[]> {
		const element = this._elementMap.get(
			(elementHash ?? '') as ElementHash,
		);

		if (!element) {
			return [];
		}

		const hasChildren = (element: CaseElement | FileElement) =>
			element.children.length;
		const getHash = (
			element: CaseElement | FileElement | DiagnosticElement,
		) => element.hash;

		if (element.kind === 'ROOT') {
			return element.children.filter(hasChildren).map(getHash);
		}

		if (element.kind === 'CASE') {
			return element.children.filter(hasChildren).map(getHash);
		}

		if (element.kind === 'FILE') {
			return element.children.map(getHash);
		}

		return [];
	}

	public getTreeItem(
		elementHash: ElementHash,
	): TreeItem | Thenable<TreeItem> {
		const element = this._elementMap.get(elementHash);

		if (!element) {
			throw new Error(
				`Could not find an element with hash ${elementHash}`,
			);
		}

		if (element.kind === 'ROOT') {
			throw new Error(`Cannot get a tree item for the root element`);
		}

		const treeItem = new TreeItem2(element.label);

		treeItem.id = element.hash;

		treeItem.collapsibleState =
			element.kind === 'FILE' || element.kind === 'CASE'
				? TreeItemCollapsibleState.Collapsed
				: TreeItemCollapsibleState.None;

		treeItem.iconPath = join(
			__filename,
			'..',
			'..',
			'resources',
			getElementIconBaseName(element.kind),
		);

		if (element.kind === 'DIAGNOSTIC') {
			treeItem.contextValue = 'jobElement';

			const tooltip = new MarkdownString(
				'Adhere to the code organization rules [here](command:intuita.openTopLevelNodeKindOrderSetting)',
			);

			tooltip.isTrusted = true;

			treeItem.tooltip = tooltip;

			treeItem.command = {
				title: 'Diff View',
				command: 'vscode.diff',
				arguments: [
					buildFileUri(element.uri),
					buildJobUri(element.job),
					'Proposed change',
				],
			};
		}

		if (element.kind === 'CASE') {
			treeItem.contextValue = 'caseElement';
		}

		return treeItem;
	}

	protected async _onUpdateInternalDiagnostics(
		message: Message & { kind: MessageKind.updateInternalDiagnostics },
	) {
		const rootPath = workspace.workspaceFolders?.[0]?.uri.path ?? '';

		const caseDtos = this._caseManager.getCasesWithJobHashes();

		const jobMap = this._buildJobMap(caseDtos);

		const caseElements = this.buildCaseElements(rootPath, caseDtos, jobMap);

		this.setDiagnostics(jobMap);

		const rootElement: RootElement = {
			hash: ROOT_ELEMENT_HASH,
			kind: 'ROOT',
			children: caseElements,
		};

		// update collections
		this._elementMap.clear();
		this._childParentMap.clear();

		this._setElement(rootElement);

		const diagnosticElement = getFirstDiagnosticElement(rootElement);

		// update the UX state
		this.eventEmitter.fire();

		if (!diagnosticElement) {
			return;
		}

		const showTheFirstJob = async () => {
			await commands.executeCommand(
				'vscode.diff',
				buildFileUri(diagnosticElement.uri),
				buildJobUri(diagnosticElement.job),
				'Proposed change',
			);

			if (!this._reveal) {
				return;
			}

			await this._reveal(diagnosticElement.hash, {
				select: true,
				focus: true,
			});
		};

		const inactiveJobHashes: JobHash[] = [];
		const oldActiveJobHashCount = this._activeJobHashes.size;

		for (const jobHash of this._activeJobHashes) {
			if (!jobMap.has(jobHash)) {
				inactiveJobHashes.push(jobHash);
			}
		}

		for (const jobHash of jobMap.keys()) {
			this._activeJobHashes.add(jobHash);
		}

		for (const jobHash of inactiveJobHashes) {
			this._activeJobHashes.delete(jobHash);
		}

		const newActiveJobHashCount = this._activeJobHashes.size;

		if (
			message.trigger === 'didSave' &&
			newActiveJobHashCount > oldActiveJobHashCount
		) {
			window
				.showInformationMessage(
					`Generated ${
						newActiveJobHashCount - oldActiveJobHashCount
					} core-repair recommendations`,
					'Show the first recommendation',
				)
				.then(async (response) => {
					if (!response) {
						return;
					}

					await showTheFirstJob();
				});

			return;
		}

		if (message.trigger === 'onCommand') {
			setImmediate(showTheFirstJob);
		}
	}

	protected _setElement(element: Element) {
		this._elementMap.set(element.hash, element);

		if (!('children' in element)) {
			return;
		}

		element.children.forEach((childElement) => {
			this._childParentMap.set(childElement.hash, element.hash);

			this._setElement(childElement);
		});
	}

	protected _buildJobMap(
		caseDtos: ReadonlyArray<CaseWithJobHashes>,
	): ReadonlyMap<JobHash, Job> {
		const jobs = caseDtos.flatMap((caseDto) =>
			caseDto.jobHashes
				.map((jobHash) => this._jobManager.getJob(jobHash))
				.filter(isNeitherNullNorUndefined),
		);

		const entries = jobs.map((job) => [job.hash, job] as const);

		return new Map(entries);
	}

	protected buildCaseElements(
		rootPath: string,
		caseDtos: ReadonlyArray<CaseWithJobHashes>,
		jobMap: ReadonlyMap<JobHash, Job>,
	): ReadonlyArray<CaseElement> {
		return caseDtos.map((caseDto): CaseElement => {
			const jobs = caseDto.jobHashes
				.map((jobHash) => jobMap.get(jobHash))
				.filter(isNeitherNullNorUndefined);

			const fileNames = Array.from(
				new Set(jobs.map((job) => job.fileName)),
			);

			const children = fileNames.map((fileName): FileElement => {
				const label = fileName.replace(rootPath, '');

				const children = jobs
					.filter((job) => job.fileName === fileName)
					.map((job) => buildDiagnosticElement(job));

				return buildFileElement(caseDto.hash, label, children);
			});

			return buildCaseElement(caseDto, children);
		});
	}

	// TODO separate creation from setup
	protected setDiagnostics(jobMap: ReadonlyMap<JobHash, Job>): void {
		const jobs = Array.from(jobMap.values());

		const fileNames = Array.from(new Set(jobs.map((job) => job.fileName)));

		fileNames.forEach((fileName) => {
			const diagnostics = jobs
				.filter((job) => job.fileName === fileName)
				.map((job) => buildDiagnostic(job));

			const uri = Uri.parse(fileName);

			this._diagnosticCollection.set(uri, diagnostics);
		});
	}
}
