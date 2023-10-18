-- load the luaunit module
local luaunit = require('luaunit')
local contract = require('index')
local util = require('common.util')

-- Define the test class
Test = {}

-- Define a test case
function Test:test_noFunk()
  local state = {
    balances = {
      x = 10,
      y = 5
    }
  }

  local action = {
    caller = "x",
    input = {
      target = "y",
      qty = 3
    }
  }

  local output = contract.handle(state, action, {})
  luaunit.assertEquals(output.result.error, "No function supplied or function not recognized. undefined") -- Check if add(2, 3) equals 5
end

function Test:test_wrongFunk()
  local state = {
    balances = {
      x = 10,
      y = 5
    }
  }

  local action = {
    caller = "x",
    input = {
      target = "y",
      qty = 3
    }
  }

  action.input['function'] = 'not-recognized'

  local output = contract.handle(state, action, {})
  luaunit.assertEquals(output.result.error, "No function supplied or function not recognized. not-recognized")
end

function Test:test_transfer()
  local state = {
    balances = {
      x = 10,
      y = 5
    }
  }

  local action = {
    caller = "x",
    input = {
      target = "y",
      qty = 3
    }
  }

  -- Set the function after cause lua doesnt like the word "function".
  action.input['function'] = 'transfer';

  local SmartWeave = {
    contract = {
      id = '<contract-id>'
    },
    transaction = {
      owner = "<owner>"
    }
  }

  local output = contract.handle(state, action, SmartWeave)
  print("Output ============")
  util.printTable(output)
  luaunit.assertEquals(output.state.balances.x, 7) -- Check if add(2, 3) equals 5
  luaunit.assertEquals(output.state.balances.y, 8) -- Check if add(2, 3) equals 5
end

function Test:test_mint()
  local state = {
    balances = {
      x = 10,
      y = 5
    },
    minted = {
      x = 1
    }
  }

  local action = {
    caller = "x",
    input = {}
  }

  local SmartWeave = {
    block = {
      height = 721
    }
  }

  -- Set the function after cause lua doesnt like the word "function".
  action.input['function'] = 'mint';

  local output = contract.handle(state, action, SmartWeave)
  print('output')
  util.printTable(output)
  luaunit.assertEquals(output.state.balances.x, 1000010) -- Check if add(2, 3) equals 5
end

-- Run the test
luaunit.run()
