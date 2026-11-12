{
  description = "Streets の開発環境";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
    in
    {
      devShells = nixpkgs.lib.genAttrs systems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [
              # .node-version に合わせる。
              pkgs.nodejs_24
              # 依存をまだ入れていない clone を一度だけ立ち上げるため。
              # ふだんの入れ直しは vp install を使う。
              pkgs.pnpm_12
            ];
            shellHook = ''
              root="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
              bin="$root/node_modules/.bin"
              node="$(command -v node)"
              bash="$(command -v bash)"

              # NixOS には /bin/sh も /usr/bin/env も無い。pnpm が作る bin は
              # #!/bin/sh、パッケージの bin は #!/usr/bin/env node で始まるので、
              # そのままだと vp も、vp が呼ぶ道具（tsgolint など）も動かない。
              # pnpm は入れ直すたびに作り直すため、シェルに入るたびに直す。
              patch_shebang() {
                file="$1"
                [ -f "$file" ] || return 0
                first=""
                IFS= read -r first < "$file" || true
                case "$first" in
                  "#!/bin/sh" | "#!/usr/bin/env sh" | "#!/usr/bin/env bash")
                    interp="$bash"
                    ;;
                  "#!/usr/bin/env node") interp="$node" ;;
                  *) return 0 ;;
                esac
                tmp="$file.tmp.$$"
                {
                  printf '#!%s\n' "$interp"
                  tail -n +2 "$file"
                } > "$tmp" && chmod +x "$tmp" && mv "$tmp" "$file"
              }

              if [ -d "$bin" ]; then
                find "$root" -name .pnpm -prune -o -type d -name .bin -print0 \
                  | while IFS= read -r -d "" dir; do
                      for file in "$dir"/*; do
                        patch_shebang "$file"
                      done
                    done
                find "$root/node_modules" -maxdepth 8 -type f -path "*/bin/*" \
                  -print0 \
                  | while IFS= read -r -d "" file; do
                      patch_shebang "$file"
                    done
                case ":$PATH:" in
                  *":$bin:"*) ;;
                  *) export PATH="$bin:$PATH" ;;
                esac
              else
                echo "依存がまだありません。'pnpm install --ignore-scripts' を実行してから、このシェルに入り直してください（その後は vp install）。" >&2
              fi

              # vp config が作る git hook も #!/usr/bin/env sh で始まる。
              if [ -d "$root/.vite-hooks/_" ]; then
                for hook in "$root"/.vite-hooks/_/*; do
                  patch_shebang "$hook"
                done
              fi
            '';
          };
        }
      );
    };
}
