local contract = {
  _version = "0.0.1"
}

--- hyper63/either module (Converted to LUA by jshaw via chatgpt)
---
--- This module implements the either monad the codebase is largely based from Dr. Boolean - Brian Lonsdorf and his
--- frontend masters courses. The two reasons for pulling these into independent modules is that over time
--- we may want to add additional helper functions to the type, and to reduce third party dependencies.
---

--- @table Either
--- @field isLeft function
--- @field chain function
--- @field ap function
--- @field alt function
--- @field extend function
--- @field concat function
--- @field traverse function
--- @field map function
--- @field toString function
--- @field extract function

--- @param x any
--- @return Either
function Right(x)
  return {
    isLeft = false,
    chain = function(f)
      return f(x)
    end,
    ap = function(other)
      return other.map(x)
    end,
    alt = function(other)
      return Right(x)
    end,
    extend = function(f)
      return f(Right(x))
    end,
    concat = function(other)
      return other.fold(function(x)
        return other
      end, function(y)
        return Right(x .. y)
      end)
    end,
    traverse = function(of, f)
      return f(x):map(Right)
    end,
    map = function(f)
      return Right(f(x))
    end,
    fold = function(_, g)
      return g(x)
    end,
    toString = function()
      return "Right(" .. x .. ")"
    end,
    extract = function()
      return x
    end
  }
end

--- @param x any
--- @return Either
function Left(x)
  return {
    isLeft = true,
    chain = function(_)
      return Left(x)
    end,
    ap = function(_)
      return Left(x)
    end,
    extend = function(_)
      return Left(x)
    end,
    alt = function(other)
      return other
    end,
    concat = function(_)
      return Left(x)
    end,
    traverse = function(of, _)
      return of(Left(x))
    end,
    map = function(_)
      return Left(x)
    end,
    fold = function(f, _)
      return f(x)
    end,
    toString = function()
      return "Left(" .. x .. ")"
    end,
    extract = function()
      return x
    end
  }
end

--- @param x any
--- @return Either
function of(x)
  return Right(x)
end

--- @param f function
--- @return Either
function tryCatch(f)
  local success, result = pcall(f)
  if success then
    return Right(result)
  else
    return Left(result)
  end
end

--- @param x any
--- @return Either
function fromNullable(x)
  return x ~= nil and Right(x) or Left(x)
end

Either = {
  Right = Right,
  Left = Left,
  of = of,
  tryCatch = tryCatch,
  fromNullable = fromNullable
}

local Util = {}

function Util.error(error)
  -- print(input)
  return {
    result = {
      error = error
    }
  }
end

function Util.success(payload)
  -- printTable(input)
  return {
    state = payload.state,
    result = payload.result
  }
end

function Util.printTable(table, indent)
  indent = indent or 0

  for k, v in pairs(table) do
    if type(v) == "table" then
      print(string.rep("  ", indent) .. k .. " = {")
      Util.printTable(v, indent + 1)
      print(string.rep("  ", indent) .. "}")
    else
      print(string.rep("  ", indent) .. k .. " = " .. tostring(v))
    end
  end
end

local function validateMint(payload)
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

local function mint(state, action, SmartWeave)
  return Either.of({
    state = state,
    action = action,
    SmartWeave = SmartWeave
  }).chain(validateMint).map(updateBalance).fold(Util.error, Util.success)
end

local function validateTransfer(payload)
  local target = (payload.action and payload.action.input and payload.action.input.target) or nil
  -- This will be "nil" if it's a string that isn't a number 
  -- (or cant be converted to one for the technical peeps out there).
  -- If that's the case, the "if not qty" will exit Left.
  local qty = (payload.action and payload.action.input and tonumber(payload.action.input.qty)) or nil

  -- you don't have to check this cause there's bigger problems if this isnt there.
  local caller = payload.action.caller

  -- Make sure target exists
  if not target then
    return Either.Left('Please specify a target.')
  end

  -- Make sure target isnt caller
  if target == caller then
    return Either.Left('Target cannot be caller.')
  end

  -- Make sure qty exists
  if not qty then
    return Either.Left('qty must be an integer greater than 0.')
  end

  -- I might be able to just do this up top, dunno
  local safeQty = math.floor(qty);
  -- make sure qty is greater than 0
  if math.floor(qty) < 0 then
    return Either.Left('Invalid token transfer. qty must be an integer greater than 0.')
  end

  if (payload.state.balances[caller] or 0) < math.floor(qty) then
    return Either.Left('Not enough tokens for transfer.')
  end

  -- give the floored value to the transformer
  payload.action.input.qty = safeQty;
  return Either.Right(payload)
end

-- Update balances.
local function updateBalances(payload)
  local state = payload.state
  local target = payload.action.input.target
  local qty = payload.action.input.qty
  local caller = payload.action.caller

  if state.balances[target] then
    state.balances[target] = state.balances[target] + qty
  else
    state.balances[target] = qty
  end

  state.balances[caller] = state.balances[caller] - qty

  return payload
end

local function notify(payload)
  local state = payload.state
  local action = payload.action
  local SmartWeave = payload.SmartWeave
  local output = {
    state = state,
    result = {
      messages = {{
        target = action.input.target,
        message = {
          type = action.input['function'],
          from = SmartWeave.contract.id,
          owner = SmartWeave.transaction.owner,
          qty = action.input.qty
        }
      }}
    }
  }

  return output
end

local function transfer(state, action, SmartWeave)
  return Either.of({
    state = state,
    action = action,
    SmartWeave = SmartWeave
  }).chain(validateTransfer).map(updateBalances).map(notify).fold(Util.error, Util.success)
end

local function balance(state, action)
  return Either.of({
    state = state,
    action = action
  }).fold(Util.error, Util.success)
end

local API = {}

API.mint = mint;
API.transfer = transfer;
API.balance = balance;

function API.default(state, action, SmartWeave)
  local funk = action.input['function'] or 'undefined'
  return {
    result = {
      error = "No function supplied or function not recognized. " .. funk
    }
  }
end

function contract.handle(state, action, SmartWeave)
  print("Running function!")
  print(action.input['function'])
  local cases = {
    mint = 'mint',
    transfer = 'transfer',
    balance = 'balance'
  }
  local funk = cases[action.input['function']] or 'default'
  return API[funk](state, action, SmartWeave)
end

return contract
