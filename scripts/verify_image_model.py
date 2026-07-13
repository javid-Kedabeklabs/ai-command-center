#!/usr/bin/env python3
"""
verify_image_model.py — independently verify which AI model generated a PNG.

ComfyUI embeds the exact generation workflow (as JSON) inside every PNG it makes,
in the 'prompt' text chunk. That includes the CheckpointLoaderSimple node with the
real ckpt_name that was used. This script reads that embedded, tamper-evident
metadata directly from the file bytes — it does NOT trust the app or any label.

Usage:
    python3 verify_image_model.py <image.png> [more.png ...]
    python3 verify_image_model.py            # checks the newest image in ComfyUI/output

Exit code 0 if a model was found, 1 otherwise.
"""
import json
import os
import struct
import sys
import glob

def read_png_text_chunks(path):
    """Parse PNG chunks by hand; return dict of tEXt/iTZ key->value (no deps)."""
    out = {}
    with open(path, "rb") as f:
        sig = f.read(8)
        if sig != b"\x89PNG\r\n\x1a\n":
            raise ValueError("not a PNG file")
        while True:
            head = f.read(8)
            if len(head) < 8:
                break
            length, ctype = struct.unpack(">I4s", head)
            data = f.read(length)
            f.read(4)  # CRC
            ctype = ctype.decode("latin-1")
            if ctype in ("tEXt", "iTXt"):
                if ctype == "tEXt":
                    key, _, val = data.partition(b"\x00")
                    out[key.decode("latin-1")] = val.decode("latin-1", "replace")
                else:  # iTXt: key\0 comp\0 method\0 lang\0 transkey\0 text
                    parts = data.split(b"\x00", 5)
                    if len(parts) == 6:
                        out[parts[0].decode("latin-1")] = parts[5].decode("utf-8", "replace")
            if ctype == "IEND":
                break
    return out

def models_from_workflow(text):
    """Pull every ckpt/unet/checkpoint name out of an embedded ComfyUI workflow JSON."""
    found = []
    try:
        wf = json.loads(text)
    except Exception:
        return found
    nodes = wf.values() if isinstance(wf, dict) else []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        inp = node.get("inputs", {}) or {}
        for key in ("ckpt_name", "unet_name", "model_name", "clip_name", "vae_name"):
            if key in inp and isinstance(inp[key], str):
                found.append((ct, key, inp[key]))
    return found

def verify(path):
    print(f"\n=== {os.path.basename(path)} ===")
    try:
        chunks = read_png_text_chunks(path)
    except Exception as e:
        print(f"  ERROR: {e}")
        return False
    any_found = False
    for chunk_key in ("prompt", "workflow"):
        if chunk_key in chunks:
            for ct, field, val in models_from_workflow(chunks[chunk_key]):
                if field in ("ckpt_name", "unet_name", "model_name"):
                    print(f"  MODEL USED  ->  {val}   (via {ct})")
                    any_found = True
    if not any_found:
        print("  No embedded model metadata found (not a ComfyUI PNG, or metadata stripped).")
    return any_found

def main():
    args = sys.argv[1:]
    if not args:
        out = os.path.expanduser("~/ComfyUI/output")
        pics = sorted(glob.glob(os.path.join(out, "*.png")), key=os.path.getmtime)
        if not pics:
            print("No images in ~/ComfyUI/output"); sys.exit(1)
        args = [pics[-1]]
        print(f"(no file given — checking newest: {os.path.basename(args[0])})")
    ok = False
    for p in args:
        ok = verify(p) or ok
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
