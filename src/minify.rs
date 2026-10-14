//! Minificación conservadora del CSS y el JS que se sirven, hecha una vez al
//! arrancar. No reescribe nada: solo quita comentarios y espacios que no
//! cambian el significado.
//!
//! - CSS: comentarios fuera; espacios seguidos, a uno; sin espacios junto a
//!   `{ } ; ,` ni tras `:`; sin el último `;` de un bloque. No se toca
//!   nada dentro de cadenas, y los espacios de `calc(a - b)` o de los
//!   selectores (`a :hover`) se quedan.
//! - JS: comentarios fuera y sangría fuera, pero **se conservan los saltos
//!   de línea** (así la inserción automática de `;` sigue igual) y no se
//!   toca nada dentro de cadenas, plantillas (con sus `${…}`) ni
//!   expresiones regulares.

/// CSS más pequeño, con el mismo significado.
pub fn css(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut it = src.chars().peekable();
    let mut pending_space = false;
    // Por cada `{` abierto: ¿dentro hay declaraciones (`color: red`) o reglas
    // (`@media … { .a { … } }`)? Junto a `:` solo se quitan espacios en las
    // declaraciones: en un selector, «a :hover» no es «a:hover».
    let mut decl: Vec<bool> = Vec::new();
    let mut prelude_start = 0usize;
    while let Some(c) = it.next() {
        match c {
            '/' if it.peek() == Some(&'*') => {
                it.next();
                let mut prev = '\0';
                for d in it.by_ref() {
                    if prev == '*' && d == '/' {
                        break;
                    }
                    prev = d;
                }
                pending_space = true;
            }
            '"' | '\'' => {
                flush_space(&mut out, &mut pending_space);
                out.push(c);
                let mut escaped = false;
                for d in it.by_ref() {
                    out.push(d);
                    if escaped {
                        escaped = false;
                    } else if d == '\\' {
                        escaped = true;
                    } else if d == c {
                        break;
                    }
                }
            }
            c if c.is_whitespace() => pending_space = true,
            ':' if decl.last() == Some(&true) => {
                pending_space = false;
                out.push(c);
                skip_ws(&mut it);
            }
            '{' | '}' | ';' | ',' => {
                pending_space = false;
                if c == '}' && out.ends_with(';') {
                    out.pop();
                }
                if c == '{' {
                    let prelude = out[prelude_start..].trim_start();
                    let rules = [
                        "@media",
                        "@supports",
                        "@container",
                        "@layer",
                        "@keyframes",
                        "@document",
                    ]
                    .iter()
                    .any(|at| prelude.starts_with(at));
                    decl.push(!rules);
                }
                if c == '}' {
                    decl.pop();
                }
                out.push(c);
                if c != ',' {
                    prelude_start = out.len();
                }
                skip_ws(&mut it);
            }
            _ => {
                flush_space(&mut out, &mut pending_space);
                out.push(c);
            }
        }
    }
    out.trim().to_owned()
}

fn skip_ws(it: &mut std::iter::Peekable<std::str::Chars<'_>>) {
    while it.peek().is_some_and(|d| d.is_whitespace()) {
        it.next();
    }
}

/// El espacio pendiente se escribe solo si separa algo que lo necesita.
fn flush_space(out: &mut String, pending: &mut bool) {
    if *pending && !out.is_empty() && !matches!(out.chars().last(), Some('{' | '}' | ';' | ',')) {
        out.push(' ');
    }
    *pending = false;
}

/// Qué viene antes de una `/` en el código: decide si es una división o el
/// principio de una expresión regular.
fn regex_can_start(out: &str) -> bool {
    let trimmed = out.trim_end();
    let Some(last) = trimmed.chars().last() else {
        return true;
    };
    if "(,=:[!&|?{};+-*%<>~^".contains(last) {
        return true;
    }
    // Tras una palabra clave también empieza una expresión regular.
    let word: String = trimmed
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '$')
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    matches!(
        word.as_str(),
        "return"
            | "typeof"
            | "case"
            | "do"
            | "else"
            | "in"
            | "of"
            | "new"
            | "delete"
            | "void"
            | "throw"
            | "yield"
            | "await"
    )
}

/// JS sin comentarios ni sangría, con los mismos saltos de línea.
pub fn js(src: &str) -> String {
    let s: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len());
    // Pila de contextos: llaves abiertas en código dentro de cada `${`.
    let mut tpl_braces: Vec<usize> = Vec::new();
    let mut braces = 0usize;
    let mut i = 0;
    let mut at_line_start = true;
    while i < s.len() {
        let c = s[i];
        // Sangría: fuera.
        if at_line_start && (c == ' ' || c == '\t') {
            i += 1;
            continue;
        }
        at_line_start = false;
        match c {
            '\n' => {
                // Sin líneas vacías ni espacios al final.
                while out.ends_with(' ') || out.ends_with('\t') {
                    out.pop();
                }
                if !out.is_empty() && !out.ends_with('\n') {
                    out.push('\n');
                }
                at_line_start = true;
                i += 1;
            }
            '/' if s.get(i + 1) == Some(&'/') => {
                while i < s.len() && s[i] != '\n' {
                    i += 1;
                }
            }
            '/' if s.get(i + 1) == Some(&'*') => {
                i += 2;
                while i + 1 < s.len() && !(s[i] == '*' && s[i + 1] == '/') {
                    i += 1;
                }
                i += 2;
            }
            '/' if regex_can_start(&out) => {
                // Expresión regular, hasta la `/` que la cierra (fuera de [ ]).
                out.push(c);
                i += 1;
                let mut class = false;
                while i < s.len() {
                    let d = s[i];
                    out.push(d);
                    i += 1;
                    match d {
                        '\\' if i < s.len() => {
                            out.push(s[i]);
                            i += 1;
                        }
                        '[' => class = true,
                        ']' => class = false,
                        '/' if !class => break,
                        '\n' => break,
                        _ => {}
                    }
                }
            }
            '\'' | '"' => {
                out.push(c);
                i += 1;
                while i < s.len() {
                    let d = s[i];
                    out.push(d);
                    i += 1;
                    if d == '\\' && i < s.len() {
                        out.push(s[i]);
                        i += 1;
                    } else if d == c || d == '\n' {
                        break;
                    }
                }
            }
            '`' => {
                out.push(c);
                i += 1;
                i = copy_template(&s, i, &mut out, &mut tpl_braces, braces);
            }
            '{' => {
                braces += 1;
                out.push(c);
                i += 1;
            }
            '}' => {
                // ¿Cierra un `${` de una plantilla? Entonces la plantilla sigue.
                if tpl_braces.last() == Some(&braces) {
                    tpl_braces.pop();
                    out.push(c);
                    i += 1;
                    i = copy_template(&s, i, &mut out, &mut tpl_braces, braces);
                } else {
                    braces = braces.saturating_sub(1);
                    out.push(c);
                    i += 1;
                }
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }
    while out.ends_with('\n') || out.ends_with(' ') {
        out.pop();
    }
    out.push('\n');
    out
}

/// Copia el cuerpo de una plantilla tal cual hasta su `` ` `` final o hasta un
/// `${`, que devuelve el control al código (apuntando en `tpl_braces` con
/// qué llave se vuelve a la plantilla).
fn copy_template(
    s: &[char],
    mut i: usize,
    out: &mut String,
    tpl_braces: &mut Vec<usize>,
    braces: usize,
) -> usize {
    while i < s.len() {
        let d = s[i];
        out.push(d);
        i += 1;
        match d {
            '\\' if i < s.len() => {
                out.push(s[i]);
                i += 1;
            }
            '`' => return i,
            '$' if s.get(i) == Some(&'{') => {
                out.push('{');
                i += 1;
                tpl_braces.push(braces);
                return i;
            }
            _ => {}
        }
    }
    i
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_keeps_meaning() {
        let src = "/* comentario */\n.a  >  .b ,\n.c:hover {\n  color : red ;\n  width: calc(100% - 2 * var(--g));\n}\n.d :is(.e) { content: \"▸ /* no */ \"; }\n@media (max-width: 520px) { .f { margin: 0 auto; } }\n";
        assert_eq!(
            css(src),
            ".a > .b,.c:hover{color:red;width:calc(100% - 2 * var(--g))}.d :is(.e){content:\"▸ /* no */ \"}@media (max-width: 520px){.f{margin:0 auto}}"
        );
    }

    #[test]
    fn js_strips_comments_and_indent_only() {
        let src = "// arriba\nfunction f(a, b) {\n    // dentro\n    const u = \"http://x\"; /* bloque */\n    return a / b / 2;\n}\n";
        assert_eq!(
            js(src),
            "function f(a, b) {\nconst u = \"http://x\";\nreturn a / b / 2;\n}\n"
        );
    }

    #[test]
    fn js_keeps_templates_and_regexes() {
        let src = "const t = `línea 1\n    // no es un comentario\n  ${a ? `${b}` : { c: 1 }.c} fin`;\nconst r = /\\/\\/[a/]+\"/g.test(x);\nconst q = (y) / 2; // división\nif (/^#ru-[a-z0-9-]+$/.test(h)) go();\n";
        assert_eq!(
            js(src),
            "const t = `línea 1\n    // no es un comentario\n  ${a ? `${b}` : { c: 1 }.c} fin`;\nconst r = /\\/\\/[a/]+\"/g.test(x);\nconst q = (y) / 2;\nif (/^#ru-[a-z0-9-]+$/.test(h)) go();\n"
        );
    }

    #[test]
    fn real_assets_shrink() {
        for (name, src) in [
            ("app.css", include_str!("../static/app.css")),
            ("app.js", include_str!("../static/app.js")),
        ] {
            let min = if name.ends_with(".css") {
                css(src)
            } else {
                js(src)
            };
            assert!(
                min.len() < src.len() * 9 / 10,
                "{name}: {} → {}",
                src.len(),
                min.len()
            );
        }
    }
}
