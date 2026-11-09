FROM python:3.12-slim

# Prevent interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install system dependencies required by Manim Community Edition:
# - ffmpeg for video encoding
# - libcairo2-dev & libpango1.0-dev for vector & text rendering
# - build-essential/gcc/pkg-config for compiling python wheels if needed
# Note: NO TeX/LaTeX installed to keep image small and lightweight
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libcairo2-dev \
    libpango1.0-dev \
    pkg-config \
    gcc \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Install Manim and NumPy
RUN pip install --no-cache-dir manim numpy

# Create non-root user for isolated execution
RUN useradd -m -u 1000 manimuser && \
    mkdir -p /work && \
    chown -R manimuser:manimuser /work

WORKDIR /work
USER manimuser

# Default command
CMD ["manim", "--help"]

