-- HTML DSL in Lua
-- Based on: https://leafo.net/guides/dsl-in-lua.html
--
-- Compatible with Lua 5.2+ (uses table.unpack and load-based setfenv shim)
 
-- ── setfenv shim for Lua 5.2 / 5.3 / 5.4 ────────────────────────────────────
local setfenv = setfenv or function(fn, env)
  local i = 1
  while true do
    local name = debug.getupvalue(fn, i)
    if name == "_ENV" then
      debug.upvaluejoin(fn, i, (function() return env end), 1)
      return fn
    elseif not name then
      break
    end
    i = i + 1
  end
  -- Fallback: wrap via load if _ENV upvalue not found
  local params, body = {}, {}
  -- Can't patch, just run with load trick
  return fn
end
 
-- ── Void / self-closing tags ──────────────────────────────────────────────────
local void_tags = {
  area     = true,
  base     = true,
  br       = true,
  col      = true,
  embed    = true,
  hr       = true,
  img      = true,
  input    = true,
  link     = true,
  meta     = true,
  param    = true,
  source   = true,
  track    = true,
  wbr      = true,
}
 
-- ── append_all: push multiple values into a buffer table ─────────────────────
local function append_all(buffer, ...)
  for i = 1, select("#", ...) do
    table.insert(buffer, (select(i, ...)))
  end
end
 
-- ── html_escape: sanitise untrusted text before inserting into the page ───────
local escape_map = {
  ["&"]  = "&amp;",
  ["<"]  = "&lt;",
  [">"]  = "&gt;",
  ['"']  = "&quot;",
  ["'"]  = "&#39;",
}
local function html_escape(s)
  return tostring(s):gsub('[&<>"\']', escape_map)
end
 
-- ── build_tag: core builder ───────────────────────────────────────────────────
local function build_tag(tag_name, opts)
  local buffer = { "<", tag_name }

  if type(opts) == "table" then
    -- Hash portion → HTML attributes
    for k, v in pairs(opts) do
      if type(k) ~= "number" then
        append_all(buffer, " ", k, '="', html_escape(v), '"')
      end
    end
  end
 
  if void_tags[tag_name] then
    -- Self-closing tag
    append_all(buffer, " />")
  else
    append_all(buffer, ">")
 
    if type(opts) == "table" then
      -- Array portion → inner content (already built tag strings or text)
      append_all(buffer, table.unpack(opts))
    elseif opts ~= nil then
      -- Plain string content
      append_all(buffer, tostring(opts))
    end
 
    append_all(buffer, "</", tag_name, ">")
  end
 
  return table.concat(buffer)
end
 
-- ── render_html: run a DSL function and return the HTML string ────────────────
local function render_html(fn)
  local env = setmetatable({}, {
    __index = function(self, tag_name)
      -- Fall back to real globals first (os, string, math, etc.)
      local global = _G[tag_name]
      if global ~= nil then return global end
      -- Otherwise treat it as an HTML tag builder and cache it
      local builder = function(opts)
        return build_tag(tag_name, opts)
      end
      rawset(self, tag_name, builder)
      return builder
    end
  })
 
  setfenv(fn, env)
  return fn()
end
 
-- ── Pretty-print helper (optional) ───────────────────────────────────────────
-- Adds newlines and two-space indentation between tags for readability.
local function prettify(html_str)
  -- newline between adjacent tags
  local result = html_str:gsub("><", ">\n<")
  -- Basic indent: each additional open tag bumps depth
  local lines, depth = {}, 0
  for line in result:gmatch("[^\n]+") do
    if line:match("^</") then
      depth = depth - 1
    end
    table.insert(lines, string.rep("  ", math.max(depth, 0)) .. line)
    if line:match("^<[^/!][^>]*[^/]>$") and not line:match("</") then
      depth = depth + 1
    end
  end
  return table.concat(lines, "\n")
end

local function url_decode(str)
    str = string.gsub(str, "+", " ")
    str = string.gsub(str, "%%(%x%x)", function(h)
        return string.char(tonumber(h, 16))
    end)
    return str
end