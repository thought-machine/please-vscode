import ast
import json
import sys


def get_rule_calls(build_filename):
    """
    Returns a list of top-level rule calls.
    ie. [{'id': 'python_test', 'name': 'calc_test', 'line': 1}, ...]
    """

    with open(build_filename) as f:
        read_data = f.read()

    module_ast = ast.parse(read_data)

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
    if len(sys.argv) != 2:
        print("Error: A BUILD filename is required.")
        sys.exit(1)

    rule_calls = get_rule_calls(sys.argv[1])
    print(json.dumps(rule_calls))
