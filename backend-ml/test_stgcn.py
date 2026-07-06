import sys
sys.path.insert(0, ".")
from app.config import get_settings
from app.ai.pose.form_stgcn import FormSTGCN
import numpy as np

settings = get_settings()
paths = [settings.stgcn_squat_m1, settings.stgcn_squat_m2, settings.stgcn_squat_m3]

print("Loading models...")
clf = FormSTGCN(model_paths=paths)

print("Feeding fake frames...")
for i in range(35):
    fake_kps = [[0.5 + np.random.randn()*0.05,
                 0.5 + np.random.randn()*0.05,
                 0.9] for _ in range(17)]
    result = clf.update(fake_kps)
    if result["ready"]:
        print(f"Frame {i}: label={result['form_label']} prob={result['good_prob']}")
        break

print("ST-GCN test passed")