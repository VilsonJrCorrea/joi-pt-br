'use-strict'
import arg from 'arg';
import { createProject } from './main';

function parseArgumentsIntoOptions(rawArgs) {
    const args = arg({
        '--init': Boolean
    }, { argv: rawArgs.slice(2) })
    return {
        runInit: args['--init'] || false
    }
}

export async function cli(args) {
    let options = parseArgumentsIntoOptions(args);
    await createProject(options);
}
