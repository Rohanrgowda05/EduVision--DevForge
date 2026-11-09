from planner.manim_run import run_manim_script

code = """from manim import *

class TestScene(Scene):
    def construct(self):
        t = Text("Hello World")
        self.play(FadeIn(t))
        self.wait(1)
"""

result = run_manim_script(code, "TestScene")
print(f"Result ok: {result.ok}")
print(f"Video path: {result.video_path}")
print(f"Error type: {result.error_type}")
print(f"Duration (s): {result.duration_s}")
