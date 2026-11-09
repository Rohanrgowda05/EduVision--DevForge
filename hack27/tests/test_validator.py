import unittest
from planner.validator import validate_manim_code, extract_scene_name_ast


class TestManimValidator(unittest.TestCase):
    def test_valid_scene_passes(self):
        code = """from manim import *
import numpy as np

config.frame_width = 14
config.frame_height = 7.5

class ValidAnimation(Scene):
    def construct(self):
        title = Text("Valid Title", font_size=36)
        self.play(FadeIn(title))
        self.wait(1)
"""
        violations = validate_manim_code(code)
        self.assertEqual(violations, [])
        self.assertEqual(extract_scene_name_ast(code), "ValidAnimation")

    def test_syntax_error(self):
        code = """from manim import *
class BrokenSyntax(Scene):
    def construct(self
        self.play(FadeIn(Text("Hi")))
"""
        violations = validate_manim_code(code)
        self.assertTrue(any("Syntax error" in v for v in violations))

    def test_forbidden_imports(self):
        code_os = """from manim import *
import os
class MaliciousScene(Scene):
    def construct(self):
        pass
"""
        violations = validate_manim_code(code_os)
        self.assertTrue(any("Forbidden import 'os'" in v for v in violations))

        code_from = """from manim import *
from subprocess import Popen
class MaliciousScene(Scene):
    def construct(self):
        pass
"""
        violations = validate_manim_code(code_from)
        self.assertTrue(any("Forbidden import from 'subprocess'" in v for v in violations))

    def test_forbidden_calls_and_names(self):
        code = """from manim import *
class ExploitScene(Scene):
    def construct(self):
        eval("1 + 1")
        open("/etc/passwd", "r")
        exec("import os")
"""
        violations = validate_manim_code(code)
        self.assertTrue(any("Forbidden identifier 'eval'" in v for v in violations))
        self.assertTrue(any("Forbidden identifier 'open'" in v for v in violations))
        self.assertTrue(any("Forbidden identifier 'exec'" in v for v in violations))

    def test_dunder_getattr_forbidden(self):
        code = """from manim import *
class DunderScene(Scene):
    def construct(self):
        c = getattr(self, "__class__")
"""
        violations = validate_manim_code(code)
        self.assertTrue(any("getattr with dunder" in v for v in violations))

    def test_forbidden_manim_apis(self):
        code = """from manim import *
class BadApiScene(Scene):
    def construct(self):
        formula = MathTex("E = mc^2")
        label = Tex("Energy")
        num = DecimalNumber(42)
        txt = Text("Sample")
        part = txt.get_part_by_text("S")
        line = Line(LEFT, RIGHT)
        normal = line.get_unit_normal()
        vec = line.get_unit_vector()
"""
        violations = validate_manim_code(code)
        self.assertTrue(any("MathTex" in v for v in violations))
        self.assertTrue(any("Tex" in v for v in violations))
        self.assertTrue(any("DecimalNumber" in v for v in violations))
        self.assertTrue(any("get_part_by_text" in v for v in violations))
        self.assertTrue(any("get_unit_normal" in v for v in violations))
        self.assertTrue(any("get_unit_vector" in v for v in violations))

    def test_missing_scene_class(self):
        code = """from manim import *
def foo():
    pass
"""
        violations = validate_manim_code(code)
        self.assertTrue(any("Missing Scene class" in v for v in violations))

    def test_multiple_scene_classes(self):
        code = """from manim import *
class FirstScene(Scene):
    def construct(self):
        pass
class SecondScene(Scene):
    def construct(self):
        pass
"""
        violations = validate_manim_code(code)
        self.assertTrue(any("Found 2 Scene classes" in v for v in violations))

    def test_scene_missing_construct(self):
        code = """from manim import *
class SceneWithoutConstruct(Scene):
    def setup(self):
        pass
"""
        violations = validate_manim_code(code)
        self.assertTrue(any("must define a construct" in v for v in violations))

    def test_update_text_play_misuse(self):
        code = """from manim import *
class MisuseScene(Scene):
    def construct(self):
        def update_text(t):
            pass
        self.play(update_text("Bad call"))
"""
        violations = validate_manim_code(code)
        self.assertTrue(any("Do NOT wrap 'update_text" in v for v in violations))


if __name__ == "__main__":
    unittest.main()

