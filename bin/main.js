import chalk from 'chalk';
import fs from 'fs';
import ncp from 'ncp';
import path from 'path';
import Listr from 'listr';
import { promisify } from 'util';

const access = promisify(fs.access);
const copy = promisify(ncp);

async function copyTemplateFiles(options) {
    return copy(options.templateDirectory, options.targetDirectory, {
        clobber: false,
    });
}

export async function createProject(options) {
    options = {
        ...options,
        targetDirectory: options.targetDirectory || process.cwd(),
    }
    const currentFileUrl = import.meta.url;
    const templateDir = path.resolve(new URL(currentFileUrl).pathname, '../template');
    options.templateDirectory = templateDir;
    try {
        await access(templateDir, fs.constants.R_OK);
    } catch (err) {
        console.error('%s Something failed in init proccess', chalk.red.bold('ERROR'));
        process.exit(1);
    }
    const tasks = new Listr([
        {
            title: 'Copy config files',
            task: () => copyTemplateFiles(options)
        }
    ])
    await tasks.run();
    await copyTemplateFiles(options);
    console.log('%s Config file is ready', chalk.green.bold('DONE'));
    return true;
}
