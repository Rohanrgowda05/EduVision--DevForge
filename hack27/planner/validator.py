"""
AST Validator for LLM-generated Manim scripts.

IMPORTANT: This validator is a fast first filter and a source of precise,
actionable error messages for the LLM repair loop.
It is NOT the security boundary; the Docker sandbox container is.
"""

import ast
from typing import List, Tuple

ALLOWED_MODULES = {"manim", "numpy", "math", "random"}

FORBIDDEN_NAMES = {
    "open",
    "exec",
    "eval",
    "compile",
    "__import__",
    "os",
    "sys",
    "subprocess",
    "socket",
    "shutil",
}

FORBIDDEN_DUNDER_ATTRS = {
    "__subclasses__",
    "__globals__",
    "__code__",
    "__builtins__",
    "__class__",
    "__bases__",
}

FORBIDDEN_MANIM_APIS = {
    "MathTex",
    "Tex",
    "DecimalNumber",
    "add_coordinates",
    "get_part_by_text",
    "get_unit_normal",
    "get_unit_vector",
}


class ManimCodeVisitor(ast.NodeVisitor):
    def __init__(self):
        self.violations: List[str] = []
        self.scene_classes: List[Tuple[ast.ClassDef, bool]] = []  # (class_node, has_construct)

    def visit_Import(self, node: ast.Import):
        for alias in node.names:
            root_module = alias.name.split(".")[0]
            if root_module not in ALLOWED_MODULES:
                self.violations.append(
                    f"Forbidden import '{alias.name}' at line {node.lineno}. "
                    f"Only manim, numpy, math, and random are permitted."
                )
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom):
        if node.module:
            root_module = node.module.split(".")[0]
            if root_module not in ALLOWED_MODULES:
                self.violations.append(
                    f"Forbidden import from '{node.module}' at line {node.lineno}. "
                    f"Only manim, numpy, math, and random are permitted."
                )
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name):
        if node.id in FORBIDDEN_NAMES:
            self.violations.append(
                f"Forbidden identifier '{node.id}' at line {node.lineno}. "
                f"File I/O, system access, and dynamic code execution are forbidden."
            )
        elif node.id in FORBIDDEN_MANIM_APIS:
            self.violations.append(
                f"Forbidden Manim API '{node.id}' at line {node.lineno}. "
                f"Use Text() and standard vector calculations instead."
            )
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute):
        if node.attr in FORBIDDEN_MANIM_APIS:
            self.violations.append(
                f"Forbidden Manim API attribute/method '{node.attr}' at line {node.lineno}. "
                f"Use Text() or manual vector calculations instead."
            )
        if node.attr in FORBIDDEN_DUNDER_ATTRS:
            self.violations.append(
                f"Forbidden dunder attribute access '{node.attr}' at line {node.lineno}."
            )
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call):
        # Check getattr(..., "__dunder__")
        if isinstance(node.func, ast.Name) and node.func.id == "getattr":
            if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                attr_val = str(node.args[1].value)
                if attr_val.startswith("__") and attr_val.endswith("__"):
                    self.violations.append(
                        f"Forbidden use of getattr with dunder name '{attr_val}' at line {node.lineno}."
                    )

        # Check self.play(update_text(...)) misuse
        if isinstance(node.func, ast.Attribute):
            if (
                isinstance(node.func.value, ast.Name)
                and node.func.value.id == "self"
                and node.func.attr == "play"
            ):
                for arg in node.args:
                    if isinstance(arg, ast.Call) and isinstance(arg.func, ast.Name) and arg.func.id == "update_text":
                        self.violations.append(
                            f"Misuse at line {node.lineno}: Do NOT wrap 'update_text(...)' inside 'self.play(...)'. "
                            f"Call update_text(...) directly."
                        )

        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef):
        # Check if this class inherits from Scene (e.g. Scene, ThreeDScene, etc.)
        is_scene = False
        for base in node.bases:
            if isinstance(base, ast.Name) and (base.id == "Scene" or base.id.endswith("Scene")):
                is_scene = True
                break
            elif isinstance(base, ast.Attribute) and (base.attr == "Scene" or base.attr.endswith("Scene")):
                is_scene = True
                break

        if is_scene:
            has_construct = any(
                isinstance(item, ast.FunctionDef) and item.name == "construct"
                for item in node.body
            )
            self.scene_classes.append((node, has_construct))

        self.generic_visit(node)


def validate_manim_code(code: str) -> List[str]:
    """
    Validate Manim Python script AST against security and correctness constraints.
    Returns a list of violations (empty list means code passed validation).
    """
    if not code or not code.strip():
        return ["Generated code is empty."]

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return [f"Syntax error at line {e.lineno}: {e.msg}"]

    visitor = ManimCodeVisitor()
    visitor.visit(tree)
    violations = list(visitor.violations)

    # Check Scene class count and construct method
    if len(visitor.scene_classes) == 0:
        violations.append(
            "Missing Scene class. The script must define exactly one class that subclasses Scene with a construct(self) method."
        )
    elif len(visitor.scene_classes) > 1:
        names = [cls_node.name for cls_node, _ in visitor.scene_classes]
        violations.append(
            f"Found {len(visitor.scene_classes)} Scene classes ({', '.join(names)}). Exactly one Scene class is required."
        )
    else:
        cls_node, has_construct = visitor.scene_classes[0]
        if not has_construct:
            violations.append(f"Scene class '{cls_node.name}' must define a construct(self) method.")

    return violations


def extract_scene_name_ast(code: str) -> str | None:
    """Extract the first Scene subclass name using AST."""
    try:
        tree = ast.parse(code)
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                for base in node.bases:
                    if (isinstance(base, ast.Name) and (base.id == "Scene" or base.id.endswith("Scene"))) or \
                       (isinstance(base, ast.Attribute) and (base.attr == "Scene" or base.attr.endswith("Scene"))):
                        return node.name
    except Exception:
        pass
    return None

