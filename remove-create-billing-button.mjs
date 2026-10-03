// Run from the project root:  node remove-create-billing-button.mjs
// Removes the header "Create billing" button, which only switched tabs and did not create anything.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

if (!existsSync('src/App.tsx')) { console.error('Run this from the project root (the folder that contains src/App.tsx).'); process.exit(1) }

let app = readFileSync('src/App.tsx', 'utf8')
const crlf = app.includes('\r\n')
app = app.replace(/\r\n/g, '\n')

const button = "<button className=\"button button-primary\" onClick={() => setTab('Billings')}><Plus size={15} />Create billing</button>"
const wrapped = "{tab !== 'Billings' && " + button + "}"

let removed = false
for (const variant of [wrapped, button]) {
  const count = app.split(variant).length - 1
  if (count === 1) { app = app.replace(variant, () => ''); removed = true; break }
  if (count > 1) { console.error('Found the button more than once; not changing anything.'); process.exit(1) }
}
if (!removed) { console.log('The Create billing button is already removed - nothing to do.'); process.exit(0) }

writeFileSync('src/App.tsx', crlf ? app.replace(/\n/g, '\r\n') : app)
console.log('Done: header Create billing button removed.')
