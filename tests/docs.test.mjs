// README claims about CI must match .github/workflows/deploy.yml.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ROOT } from './helpers/setup.mjs'

test('README says what the deploy workflow does with the tests', () => {
  const workflow = readFileSync(`${ROOT}/.github/workflows/deploy.yml`, 'utf8')
  const readme = readFileSync(`${ROOT}/README.md`, 'utf8').replace(/\s+/g, ' ')
  const runsTests = /^\s*- run: npm test\s*$/m.test(workflow)
  assert.equal(/deploy workflow does not run the tests/.test(readme), !runsTests)
  assert.equal(/deploy workflow runs `npm test`/.test(readme), runsTests)
})
