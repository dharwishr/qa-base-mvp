"""Text generator utility for auto-generating input values.

Provides smart detection of field types from element names and generates
appropriate random values for each field type.
"""
import random
import string
import time


def generate_auto_text(element_name: str | None = None) -> str:
    """Generate unique auto-generated text based on field type detection.

    Args:
        element_name: The name of the element (used for field type detection)

    Returns:
        A unique auto-generated text value appropriate for the detected field type
    """
    field_type = _detect_field_type(element_name)

    if field_type == "email":
        chars = ''.join(random.choices(string.ascii_lowercase, k=6))
        return f"auto_{chars}_{int(time.time())}@test.com"

    elif field_type == "phone":
        return f"555-{random.randint(100, 999)}-{random.randint(1000, 9999)}"

    elif field_type == "username":
        chars = ''.join(random.choices(string.ascii_lowercase, k=6))
        return f"user_{chars}_{random.randint(100, 999)}"

    elif field_type == "name":
        prefixes = ["Test", "Auto", "QA"]
        chars = ''.join(random.choices(string.ascii_lowercase, k=4))
        return f"{random.choice(prefixes)}_{chars.title()}"

    elif field_type == "password":
        chars = ''.join(random.choices(string.ascii_letters + string.digits, k=10))
        return f"Pass_{chars}!"

    else:  # generic
        chars = ''.join(random.choices(string.ascii_letters + string.digits, k=8))
        return f"auto_{chars}_{int(time.time())}"


def _detect_field_type(element_name: str | None) -> str:
    """Detect field type from element name.

    Args:
        element_name: The name of the element

    Returns:
        The detected field type: 'email', 'phone', 'username', 'name', 'password', or 'generic'
    """
    if not element_name:
        return "generic"

    name_lower = element_name.lower()

    if any(k in name_lower for k in ["email", "e-mail", "mail"]):
        return "email"
    elif any(k in name_lower for k in ["phone", "mobile", "tel", "cell"]):
        return "phone"
    elif any(k in name_lower for k in ["user", "username", "login", "handle"]):
        return "username"
    elif any(k in name_lower for k in ["name", "first", "last", "full"]):
        return "name"
    elif any(k in name_lower for k in ["pass", "password", "pwd", "secret"]):
        return "password"

    return "generic"
