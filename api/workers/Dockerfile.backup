# Dockerfile for EEG Analysis Worker
# Build: docker build -t eeg-worker .
# Run: docker run -e SUPABASE_URL=... -e SUPABASE_KEY=... eeg-worker

FROM python:3.11-slim

# Install system dependencies for MNE
RUN apt-get update && apt-get install -y \
    build-essential \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy worker scripts
COPY preprocess.py .
COPY extract_features.py .
COPY analyze_eeg.py .

# Make analyzer executable
RUN chmod +x analyze_eeg.py

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Default command (can be overridden)
CMD ["python", "analyze_eeg.py", "--help"]
