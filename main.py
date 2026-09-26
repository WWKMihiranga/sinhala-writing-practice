import torch
from torchvision import models
from huggingface_hub import hf_hub_download

model_path = hf_hub_download(
    repo_id="sanjeevan7/emnist-letters-sinhala-resnet18-v2",
    filename="pytorch_model.bin",
    local_dir="./models"
)

print("Model downloaded to:")
print(model_path)

model = models.resnet18()
model.fc = torch.nn.Linear(model.fc.in_features, 454)

model.load_state_dict(
    torch.load(model_path, map_location=torch.device("cpu"))
)

model.eval()

print("Model loaded successfully!")
