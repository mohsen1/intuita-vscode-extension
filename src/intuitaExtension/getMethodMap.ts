import {ClassInstanceProperty} from "./classInstanceProperty";
import {concatMutabilities, Mutability} from "./mutability";

export type Method = Readonly<{
    methodNames: ReadonlyArray<string>,
    propertyNames: ReadonlyArray<string>,
    propertyMutability: Mutability,
}>;

export const getMethodMap = (
    properties: ReadonlyArray<ClassInstanceProperty>,
    methods: ReadonlyArray<[string, ReadonlyArray<string>]>,
): ReadonlyMap<string, Method> => {
    const methodMap = new Map<string, Method>(
        methods.map(([methodName, methodNames]) => ([
            methodName,
            {
                propertyNames: [],
                methodNames,
                propertyMutability: Mutability.READING_READONLY,
            }
        ]))
    );

    properties.forEach(
        (property) => {
            property.methodNames.forEach(
                (methodName) => {
                    const method = methodMap.get(methodName);

                    if (!method) {
                        return;
                    }

                    const propertyNames = method.propertyNames.slice();
                    propertyNames.push(property.name);

                    const propertyMutability = concatMutabilities(
                        [
                            property.readonly
                                ? Mutability.READING_READONLY
                                : Mutability.WRITING_WRITABLE,
                            method.propertyMutability,
                        ]
                    );

                    methodMap.set(
                        methodName,
                        {
                            propertyNames,
                            propertyMutability,
                            methodNames: method.methodNames,
                        },
                    );
                }
            );
        }
    );

    return methodMap;
};



