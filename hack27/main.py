from flask import Flask, request, jsonify
import traceback
import re
from flask_cors import CORS


from planner.plannerscript import generate_dsl
from planner.manim_run import run_manim_script

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})


def extract_scene_name(code: str) -> str:
    match = re.search(r"class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*Scene\s*\)", code)
    if match:
        return match.group(1)
    return "Scene"


@app.route("/generate", methods=["POST"])
def generate_animation():
    try:
        data = request.get_json()

        if not data or "prompt" not in data:
            return jsonify({"error": "Missing 'prompt' field"}), 400

        user_prompt = data["prompt"]
        print("Received Prompt:", user_prompt)

        # 1. Generate DSL (Manim code)
        print("[...] Generating DSL...")
        manim_code = generate_dsl(user_prompt)
        print("[OK] Generated Manim code:")
        print(manim_code)
        print("---END CODE---")

        # 2. Extract scene name
        scene_name = extract_scene_name(manim_code)
        print(f"[INFO] Detected scene name: {scene_name}")

        # 3. Run Manim render
        print("[...] Rendering animation...")
        output_path = "static/videos/final.mp4"
        result = run_manim_script(manim_code, scene_name, output_path)

        if result is None:
            return jsonify({
                "error": "Manim failed to render. The generated code may have issues.",
                "scene_name": scene_name
            }), 500

        # 4. Return working video URL
        return jsonify({
            "status": "success",
            "video_url": "/static/videos/final.mp4"
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500



# ------------------------------------------
# Main entry
# ------------------------------------------
if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)
