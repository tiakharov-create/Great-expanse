#!/usr/bin/env python3
"""Заменяет встроенный модуль AI ANSWERS в сборке на ai_answer.js.

Использование:
    python3 patch_ai.py [входной.html] [выходной.html] [модуль.js]

По умолчанию: index.ru.html -> index.ru.new.html, модуль ai_answer.js.
Блок ищется по маркеру GE_AI_V1 (без тяжёлых регулярок по всему файлу).
"""
import sys

src = sys.argv[1] if len(sys.argv) > 1 else 'index.ru.html'
dst = sys.argv[2] if len(sys.argv) > 2 else 'index.ru.new.html'
mod_path = sys.argv[3] if len(sys.argv) > 3 else 'ai_answer.js'

with open(src, encoding='utf-8') as f:
    html = f.read()
with open(mod_path, encoding='utf-8') as f:
    module = f.read().strip()

i = html.find('GE_AI_V1')
if i < 0:
    raise SystemExit('маркер GE_AI_V1 не найден')
a = html.rfind('<script', 0, i)
b = html.find('</script>', i)
if a < 0 or b < 0:
    raise SystemExit('границы скрипта не найдены')
gt = html.find('>', a)
if gt < 0 or gt > i:
    raise SystemExit('некорректный открывающий тег скрипта')

new_html = html[:gt + 1] + '\n' + module + '\n' + html[b:]

with open(dst, 'w', encoding='utf-8') as f:
    f.write(new_html)

print(f'OK: {src} -> {dst}; модуль {len(module)} символов; размер {len(html)} -> {len(new_html)}')
