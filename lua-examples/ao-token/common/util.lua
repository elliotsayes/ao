local Main = {}

function Main.error(error)
  -- print(input)
  return {
    result = {
      error = error
    }
  }
end

function Main.success(payload)
  -- printTable(input)
  return {
    state = payload.state,
    result = payload.result
  }
end

function Main.printTable(table, indent)
  indent = indent or 0

  for k, v in pairs(table) do
    if type(v) == "table" then
      print(string.rep("  ", indent) .. k .. " = {")
      Main.printTable(v, indent + 1)
      print(string.rep("  ", indent) .. "}")
    else
      print(string.rep("  ", indent) .. k .. " = " .. tostring(v))
    end
  end
end

return Main
