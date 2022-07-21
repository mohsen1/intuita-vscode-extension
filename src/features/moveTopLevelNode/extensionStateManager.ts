import { Configuration } from "../../configuration";
import {MoveTopLevelNodeUserCommand} from "./1_userCommandBuilder";
import {buildMoveTopLevelNodeFact, MoveTopLevelNodeFact} from "./2_factBuilders";
import {buildTitle} from "../../actionProviders/moveTopLevelNodeActionProvider";
import {
    calculateCharacterIndex,
    calculatePosition,
    IntuitaPosition,
    IntuitaRange,
    isNeitherNullNorUndefined
} from "../../utilities";
import {executeMoveTopLevelNodeAstCommand} from "./4_astCommandExecutor";
import * as vscode from "vscode";

// probably this will change to a different name (like solution?)
export type IntuitaDiagnostic = Readonly<{
    title: string,
    range: IntuitaRange,
    fact: MoveTopLevelNodeFact,
}>;

export type IntuitaCodeAction = Readonly<{
    title: string,
    characterDifference: number,
    oldIndex: number,
    newIndex: number,
}>;

export class ExtensionStateManager {
    protected _state: Readonly<{
        fileName: string,
        diagnostics: ReadonlyArray<IntuitaDiagnostic>,
    }> | null = null;

    public constructor(
        protected readonly _configuration: Configuration,
        protected readonly _setDiagnosticEntry: (
            fileName: string,
            diagnostics: ReadonlyArray<IntuitaDiagnostic>,
        ) => void,
    ) {

    }

    public onFileTextChanged(
        fileName: string,
        fileText: string,
    ) {
        const userCommand: MoveTopLevelNodeUserCommand = {
            kind: 'MOVE_TOP_LEVEL_NODE',
            fileName,
            fileText,
            options: this._configuration,
        };

        const fact = buildMoveTopLevelNodeFact(userCommand);

        const diagnostics = fact.solutions.map(
            (solutions, index) => {
                const topLevelNode = fact.topLevelNodes[index]!;

                const solution = solutions[0]!;

                const title = buildTitle(solution, false) ?? '';

                const start = calculatePosition(
                    fact.separator,
                    fact.lengths,
                    topLevelNode.nodeStart,
                );

                const range: IntuitaRange = [
                    start[0],
                    start[1],
                    start[0],
                    fact.lengths[start[0]] ?? start[1],
                ];

                return {
                    range,
                    title,
                    fact,
                };
            }
        );

        this._state = {
            fileName,
            diagnostics,
        };

        this._setDiagnosticEntry(
            fileName,
            diagnostics,
        );
    }

    public findCodeActions(
        fileName: string,
        position: IntuitaPosition,
    ): ReadonlyArray<IntuitaCodeAction> {
        if (this._state?.fileName !== fileName) {
            return [];
        }

        return this
            ._state
            .diagnostics
            .filter(
                ({ range }) => {
                    return range[0] <= position[0]
                        && range[2] >= position[0]
                        && range[1] <= position[1]
                        && range[3] >= position[1];
                },
            )
            .map(
                ({ fact, title }) => {
                    const characterIndex = calculateCharacterIndex(
                        fact.separator,
                        fact.lengths,
                        position[0],
                        position[1],
                    );

                    const topLevelNodeIndex = fact
                        .topLevelNodes
                        .findIndex(
                        (topLevelNode) => {
                            return topLevelNode.triviaStart <= characterIndex
                                && characterIndex <= topLevelNode.triviaEnd;
                        }
                    );

                    const topLevelNode = fact.topLevelNodes[topLevelNodeIndex] ?? null;

                    if (topLevelNodeIndex === -1 || topLevelNode === null) {
                        return null;
                    }

                    const solutions = fact
                        .solutions[topLevelNodeIndex]
                        ?.filter(
                            (solution) => {
                                return solution.newIndex !== solution.oldIndex;
                            }
                        );

                    const solution = solutions?.[0] ?? null;

                    if (solution === null) {
                        return null;
                    }

                    const characterDifference = characterIndex - topLevelNode.triviaStart;

                    const {
                        oldIndex,
                        newIndex,
                    } = solution;

                    return {
                        title,
                        characterDifference,
                        oldIndex,
                        newIndex,
                    };
                }
            )
            .filter(isNeitherNullNorUndefined);
    }

    public executeCommand(
        fileName: string,
        fileText: string,
        oldIndex: number,
        newIndex: number,
        characterDifference: number,
    ) {
        if (this._state?.fileName !== fileName) {
            return;
        }

        // I am sure we can simplify it because we have all we
        // need available in this class

        const executions = executeMoveTopLevelNodeAstCommand({
            kind: "MOVE_TOP_LEVEL_NODE",
            fileName,
            fileText,
            oldIndex,
            newIndex,
            characterDifference,
        });

        const execution = executions[0] ?? null;

        if (!execution) {
            return null;
        }

        const { name, text, line, character } = execution;

        if (name !== fileName) {
            return null;
        }

        const oldLines = fileText.split('\n');
        const oldTextLastLineNumber = oldLines.length - 1;
        const oldTextLastCharacter = oldLines[oldLines.length - 1]?.length ?? 0;

        const range: IntuitaRange = [
            0,
            0,
            oldTextLastLineNumber,
            oldTextLastCharacter,
        ];

        const position: IntuitaPosition = [
            line,
            character,
        ];

        return {
            range,
            text,
            position,
        };
    }
}