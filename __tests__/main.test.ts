import cp from 'child_process'
import path from 'path'
import process from 'process'

test('test runs', () => {
  process.env['INPUT_ACTION'] = 'code-review'
  const np = process.execPath
  const ip = path.join(__dirname, '..', 'build', 'main.js')
  const options: cp.ExecFileSyncOptions = {
    env: process.env
  }
  // eslint-disable-next-line no-console
  console.log(cp.execFileSync(np, [ip], options).toString())
})
