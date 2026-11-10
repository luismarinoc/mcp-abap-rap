#!/bin/bash
# Vuelve al MCP original desde npm (npx). Doble clic para ejecutar.

CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"

echo ""
echo "=== Revirtiendo al MCP original ==="
echo ""

NPX="$(command -v npx)"
if [ -z "$NPX" ]; then
  echo "No se encontro npx en PATH; no se modifico la configuracion." >&2
  exit 1
fi

python3 - "$CFG" "$NPX" <<'PY'
import json, shutil, sys, datetime
cfg, npx = sys.argv[1], sys.argv[2]
shutil.copy(cfg, cfg + ".bak-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
d = json.load(open(cfg))
srv = d.setdefault("mcpServers", {})
env = srv.get("sap-bash-adt", {}).get("env", {})
srv["sap-bash-adt"] = {
    "command": npx,
    "args": ["-y", "mcp-abap-abap-adt-api"],
    "env": env
}
json.dump(d, open(cfg, "w"), indent=2, ensure_ascii=False)
print("Revertido al paquete de npm.")
PY

pkill -f "mcp-abap-rap/dist/index.js" 2>/dev/null

echo ""
echo "Cierra Claude con Command+Q y abrelo de nuevo."
echo ""
read -n1 -p "Pulsa una tecla para cerrar esta ventana..."
