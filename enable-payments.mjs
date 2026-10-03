// Run from the project root:  node enable-payments.mjs
// Wires the existing PaymentEntryDialog into the "Log payment" button in src/App.tsx.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const file = 'src/App.tsx'
if (!existsSync(file)) { console.error('Run this from the project root (the folder that contains src/App.tsx).'); process.exit(1) }

let text = readFileSync(file, 'utf8')
const crlf = text.includes('\r\n')
text = text.replace(/\r\n/g, '\n')

if (text.includes('PaymentEntryDialog')) { console.log('Already applied - nothing to do.'); process.exit(0) }

const edits = [
  [ // 1. import the dialog
    "import { supabase } from './lib/supabase'\n",
    "import { supabase } from './lib/supabase'\nimport { PaymentEntryDialog } from './components/PaymentEntryDialog'\n",
  ],
  [ // 2. pass a refresh callback to ProjectDetail
    "onSetup={() => openProjectSetup(selected)} />",
    "onSetup={() => openProjectSetup(selected)} onPaymentSaved={refreshWorkspace} />",
  ],
  [ // 3. ProjectDetail props + dialog state
    "function ProjectDetail({ project, payments, onBack, onSetup }: { project: Project; payments: Payment[]; onBack: () => void; onSetup: () => void }) {\n  const [tab, setTab] = useState('Overview')\n",
    "function ProjectDetail({ project, payments, onBack, onSetup, onPaymentSaved }: { project: Project; payments: Payment[]; onBack: () => void; onSetup: () => void; onPaymentSaved: () => void }) {\n  const [tab, setTab] = useState('Overview')\n  const [showPaymentDialog, setShowPaymentDialog] = useState(false)\n",
  ],
  [ // 4. enable the button and mount the dialog
    '<button className="button button-primary" disabled title="Payment entry is not connected yet"><Plus size={15} />Log payment</button></div>',
    '<button className="button button-primary" onClick={() => setShowPaymentDialog(true)}><Plus size={15} />Log payment</button></div>{showPaymentDialog && <PaymentEntryDialog project={project} onClose={() => setShowPaymentDialog(false)} onSaved={onPaymentSaved} />}',
  ],
]

for (const [from, to] of edits) {
  const count = text.split(from).length - 1
  if (count !== 1) { console.error('Could not apply an edit safely (found ' + count + ' matches for):\n' + from.slice(0, 90)); process.exit(1) }
  text = text.replace(from, () => to)
}

writeFileSync(file, crlf ? text.replace(/\n/g, '\r\n') : text)
console.log('Done: "Log payment" is now connected to the payment dialog.')
