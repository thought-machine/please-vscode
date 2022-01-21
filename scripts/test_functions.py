import ast
import json
import sys


def get_test_functions(source_file_contents):
    """
    Returns a list of test functions.
    ie. [{'id': 'test_empty_array', 'line': 1}, ...]
    """

    module_ast = ast.parse(source_file_contents)

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
    source_file_contents = ''
    for line in sys.stdin:
        source_file_contents += line

    test_functions = get_test_functions(source_file_contents)
    print(json.dumps(test_functions))
