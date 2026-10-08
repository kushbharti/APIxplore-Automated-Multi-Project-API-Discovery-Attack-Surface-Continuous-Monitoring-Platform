const fs = require('fs');
const path = require('path');
const dir = path.join('src', 'pages');

const files = fs.readdirSync(dir).filter(f => f.endsWith('.tsx'));
for (const file of files) {
  const p = path.join(dir, file);
  let content = fs.readFileSync(p, 'utf-8');
  let newContent = content.replace(/['"]destructive['"]/g, "'error'");
  
  // also fix imports for type
  newContent = newContent.replace(/import \{ Project \} from '\.\.\/types';/g, "import type { Project } from '../types';");
  newContent = newContent.replace(/import \{ Project, DiscoveryRun \} from '\.\.\/types';/g, "import type { Project, DiscoveryRun } from '../types';");
  newContent = newContent.replace(/import \{ OverviewStats \} from '\.\.\/types';/g, "import type { OverviewStats } from '../types';");

  if (content !== newContent) {
    fs.writeFileSync(p, newContent);
    console.log(`Updated ${file}`);
  }
}
