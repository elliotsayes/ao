local Either = require('common.either')
local util = require('common.util')

local M = {}

local function validate(payload)
  local caller = payload.action.caller
  local state = payload.state
  local block = payload.SmartWeave.block

  local lastMint = state.minted[caller]

  -- Make sure target exists
  if lastMint and ((block.height - lastMint) < 720) then
    -- Your code here
    return Either.Left('You can only mint 1 time every 720 blocks.')
  end

  -- give the floored value to the transformer
  return Either.Right(payload)
end

local function updateBalance(payload)
  local caller = payload.action.caller
  local state = payload.state
  local block = payload.SmartWeave.block
  local balance = state.balances[caller] or 0

  state.balances[caller] = balance + 1e6
  state.minted[caller] = block.height
  return payload
end

function M.mint(state, action, SmartWeave)
  return Either.of({
    state = state,
    action = action,
    SmartWeave = SmartWeave
  }).chain(validate).map(updateBalance).fold(util.error, util.success)
end

return M
