// @responsibility Run archived-data research.
import path from 'node:path';
import { runArchivedPaperResearch } from '../server/trading/paper/paperResearchRuntime.js';

const directory = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
const { view } = runArchivedPaperResearch(directory);
console.log(JSON.stringify(view, null, 2));
