import ast
import json
import sys


def get_rule_calls(build_file_contents):
    """
    Returns a list of top-level rule calls.
    ie. [{'id': 'python_test', 'name': 'calc_test', 'line': 1}, ...]
    """

    module_ast = ast.parse(build_file_contents)

    calls = []
    for stmt in module_ast.body:
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call) and isinstance(stmt.value.func, ast.Name):
            for kw in stmt.value.keywords:
                if kw.arg == 'name' and isinstance(kw.value, ast.Str):
                    calls.append({
                        'id': stmt.value.func.id,
                        'name': kw.value.s,
                        'line': stmt.value.lineno,
                    })

    return calls

if __name__ == '__main__':
    build_file_contents = ''
    for line in sys.stdin:
        build_file_contents += line

    rule_calls = get_rule_calls(build_file_contents)
    print(json.dumps(rule_calls))
