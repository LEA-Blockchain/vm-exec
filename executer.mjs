#!/usr/bin/env node
/**
 * @file Node.js command-line executor for Lea-chain WebAssembly modules.
 *
 * This script provides a command-line interface to load and run a WebAssembly
 * module, providing it with the necessary host function imports via the VM shim.
 * It uses explicit flags to determine the type of argument passed to the entry point.
 *
 * @example
 * # Run the 'main' function in a Wasm file with no arguments
 * node executer.mjs /path/to/module.wasm main
 *
 * @example
 * # Run with a numeric argument
 * node executer.mjs /path/to/module.wasm main --number 123
 *
 * @example
 * # Run with a string argument
 * node executer.mjs /path/to/module.wasm main --string "hello world"
 *
 * @example
 * # Run with a file path as an argument (content is passed to Wasm)
 * node executer.mjs /path/to/module.wasm main --file /path/to/data.json
 */
import { promises as fs } from 'fs';
import { argv, exit } from 'process';
import { createShim } from '@leachain/vm-shim';

function printUsage() {
    console.error('Usage: node executer.mjs <path/to/module.wasm> <entry_point> [flag] [value]');
    console.error('\nFlags:');
    console.error('  --string <value>   Pass a string to the entry point.');
    console.error('  --number <value>   Pass a number to the entry point.');
    console.error('  --file   <path>    Pass the contents of a file to the entry point.');
    exit(1);
}

async function main() {
    const wasmPath = argv[2];
    const entryPoint = argv[3];

    if (!wasmPath || !entryPoint) {
        printUsage();
    }

    const { importObject, bindInstance } = createShim();

    try {
        const wasmBytes = await fs.readFile(wasmPath);
        const { instance } = await WebAssembly.instantiate(wasmBytes, importObject);
        
        bindInstance(instance);
        const memory = instance.exports.memory;

        const func = instance.exports[entryPoint];
        if (typeof func !== 'function') {
            throw new Error(`'${entryPoint}' function not exported from ${wasmPath}`);
        }
        console.log(`[INFO] Successfully instantiated wasm module. Entry point '${entryPoint}' found.\n`);

        const flag = argv[4];
        const value = argv[5];
        let exitCode;

        if (!flag) {
            console.log('[INFO] No arguments provided. Calling entry point without arguments.\n');
            exitCode = func();
        } else {
            if (!value) {
                console.error('Error: Missing value for flag ' + flag);
                printUsage();
            }

            switch (flag) {
                case '--file': {
                    console.log(`[INFO] Argument is a file ('${value}'). Reading content.\n`);
                    const fileContent = await fs.readFile(value);
                    const transactionBytes = new Uint8Array(fileContent);
                    const dataPtr = instance.exports.__lea_malloc(transactionBytes.length);
                    if (!dataPtr) throw new Error('__lea_malloc returned NULL');
                    const mem = new Uint8Array(memory.buffer, dataPtr, transactionBytes.length);
                    mem.set(transactionBytes);
                    console.log(`[INFO] Copied file content to wasm memory at address ${dataPtr} (size: ${transactionBytes.length}).\n`);
                    console.log(`[INFO] Calling entry point with (pointer, size).\n`);
                    exitCode = func(dataPtr, transactionBytes.length);
                    break;
                }
                case '--number': {
                    const num = Number(value);
                    if (isNaN(num) || !isFinite(num)) {
                        throw new Error(`Invalid number provided for --number: ${value}`);
                    }
                    console.log(`[INFO] Argument is a number ('${num}').\n`);
                    console.log(`[INFO] Calling entry point with the number.\n`);
                    exitCode = func(num);
                    break;
                }
                case '--string': {
                    console.log(`[INFO] Argument is a string.\n`);
                    const stringBytes = new TextEncoder().encode(value);
                    const dataPtr = instance.exports.__lea_malloc(stringBytes.length);
                    if (!dataPtr) throw new Error('__lea_malloc returned NULL');
                    const mem = new Uint8Array(memory.buffer, dataPtr, stringBytes.length);
                    mem.set(stringBytes);
                    console.log(`[INFO] Copied string content to wasm memory at address ${dataPtr} (size: ${stringBytes.length}).\n`);
                    console.log(`[INFO] Calling entry point with (pointer, size).\n`);
                    exitCode = func(dataPtr, stringBytes.length);
                    break;
                }
                default: {
                    console.error(`Unknown flag: ${flag}`);
                    printUsage();
                }
            }
        }

        console.log(`[INFO] Entry point returned exit code: ${exitCode}\n`);
        exit(exitCode);
    } catch (e) {
        console.error(e);
        if (e instanceof WebAssembly.RuntimeError) {
            console.error(`VM error: ${e.message}`);
        } else {
            console.error(`Execution error ${wasmPath}:`);
            console.error(e);
        }
        exit(1);
    }
}

main().catch(e => {
    console.error(e);
    exit(1);
});
