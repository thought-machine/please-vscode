import ast
import json
import sys


def get_test_functions(filename):
    """
    Returns a list of test functions.
    ie. [{'id': 'test_empty_array', 'line': 1}, ...]
    """

    with open(filename) as f:
        read_data = f.read()

    module_ast = ast.parse(read_data)

    funcs = []
    for stmt in module_ast.body:
        if isinstance(stmt, ast.ClassDef):
            for base in stmt.bases:
                if isinstance(base, ast.Attribute) and base.attr == 'TestCase' and isinstance(base.value, ast.Name) and (base.value.id == 'unittest' or base.value.id == 'asynctest'):
                    for inner_stmt in stmt.body:
                        if (isinstance(inner_stmt, ast.FunctionDef) or isinstance(inner_stmt, ast.AsyncFunctionDef)) and inner_stmt.name.startswith('test'):
                            funcs.append({
                                'id': inner_stmt.name,
                                'line': inner_stmt.lineno,
                            })

    return funcs

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print("Error: A file is required.")
        sys.exit(1)

    test_functions = get_test_functions(sys.argv[1])
    print(json.dumps(test_functions))
