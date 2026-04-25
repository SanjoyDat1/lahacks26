"""LangGraph brain agents: reader, writer, and selective document-to-brain bootstrap helpers."""

from .builder import SourceDocument, create_brain_from_documents, normalize_documents

__version__ = "0.1.0"

__all__ = [
    "SourceDocument",
    "__version__",
    "create_brain_from_documents",
    "normalize_documents",
]
