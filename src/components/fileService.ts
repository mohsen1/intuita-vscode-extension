import {
	FilePermission,
	Position,
	Range,
	Selection,
	TextEditorRevealType,
	Uri,
	workspace,
	WorkspaceEdit,
} from 'vscode';
import { Configuration } from '../configuration';
import { Container } from '../container';
import { destructIntuitaFileSystemUri } from '../destructIntuitaFileSystemUri';
import { JobManager } from './jobManager';
import { Message, MessageBus, MessageKind } from './messageBus';
import { VSCodeService } from './vscodeService';

export class FileService {
	public constructor(
		protected readonly _configurationContainer: Container<Configuration>,
		protected readonly _jobManager: JobManager,
		protected readonly _messageBus: MessageBus,
		protected readonly _vscodeService: VSCodeService,
		protected readonly _uriStringToVersionMap: Map<string, number>,
	) {
		this._messageBus.subscribe(async (message) => {
			if (message.kind === MessageKind.readingFileFailed) {
				setImmediate(() => this._onReadingFileFailed(message));
			}

			if (message.kind === MessageKind.updateExternalFile) {
				setImmediate(() => this._onUpdateExternalFile(message));
			}
		});
	}

	protected async _onReadingFileFailed(
		message: Message & { kind: MessageKind.readingFileFailed },
	) {
		const destructedUri = destructIntuitaFileSystemUri(message.uri);

		if (!destructedUri) {
			return;
		}

		const text = await this._getText(destructedUri);

		const content = Buffer.from(text);

		const permissions =
			destructedUri.directory === 'files'
				? FilePermission.Readonly
				: null;

		this._messageBus.publish({
			kind: MessageKind.writeFile,
			uri: message.uri,
			content,
			permissions,
		});
	}

	protected async _getText(
		destructedUri: ReturnType<typeof destructIntuitaFileSystemUri>,
	): Promise<string> {
		if (destructedUri.directory === 'jobs') {
			return this._jobManager.executeJob(destructedUri.jobHash, 0).text;
		}

		const fileName = destructedUri.fsPath;
		const uri = Uri.parse(fileName);

		const textDocument = await this._vscodeService.openTextDocument(uri);

		return textDocument.getText();
	}

	protected async _onUpdateExternalFile(
		message: Message & { kind: MessageKind.updateExternalFile },
	) {
		const stringUri = message.uri.toString();

		const document = await this._vscodeService.openTextDocument(
			message.uri,
		);

		const { lineCount } = document;

		const range = new Range(
			new Position(0, 0),
			new Position(
				lineCount !== 0 ? lineCount - 1 : 0,
				lineCount !== 0
					? document.lineAt(lineCount - 1).range.end.character
					: 0,
			),
		);

		const workspaceEdit = new WorkspaceEdit();

		workspaceEdit.replace(message.uri, range, message.jobOutput.text);

		this._uriStringToVersionMap.set(stringUri, document.version + 1);

		await workspace.applyEdit(workspaceEdit);

		const { saveDocumentOnJobAccept } = this._configurationContainer.get();

		if (saveDocumentOnJobAccept) {
			await document.save();
		}

		const activeTextEditor = this._vscodeService.getActiveTextEditor();

		if (activeTextEditor?.document.uri.toString() === stringUri) {
			const position = new Position(
				message.jobOutput.position[0],
				message.jobOutput.position[1],
			);

			const selection = new Selection(position, position);

			activeTextEditor.selections = [selection];

			activeTextEditor.revealRange(
				new Range(position, position),
				TextEditorRevealType.AtTop,
			);
		}

		this._messageBus.publish({
			kind: MessageKind.externalFileUpdated,
			uri: message.uri,
		});
	}
}
