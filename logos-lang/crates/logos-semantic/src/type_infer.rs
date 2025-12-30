//! Simplified type inference

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Type {
    Unknown,
    Void,
    Bool,
    Int,
    Float,
    String,
    List(Box<Type>),
    Dict(Box<Type>, Box<Type>),
    Optional(Box<Type>),
    Function { params: Vec<Type>, return_type: Box<Type> },
    Class(String),
    TypeVar(String),
}

impl Type {
    pub fn is_unknown(&self) -> bool { matches!(self, Type::Unknown) }

    pub fn display_name(&self) -> String {
        match self {
            Type::Unknown => "any".to_string(),
            Type::Void => "void".to_string(),
            Type::Bool => "bool".to_string(),
            Type::Int => "int".to_string(),
            Type::Float => "float".to_string(),
            Type::String => "str".to_string(),
            Type::List(inner) => format!("list[{}]", inner.display_name()),
            Type::Dict(k, v) => format!("dict[{}, {}]", k.display_name(), v.display_name()),
            Type::Optional(inner) => format!("{}?", inner.display_name()),
            Type::Function { params, return_type } => {
                let p: Vec<_> = params.iter().map(|t| t.display_name()).collect();
                format!("({}) -> {}", p.join(", "), return_type.display_name())
            }
            Type::Class(name) => name.clone(),
            Type::TypeVar(name) => name.clone(),
        }
    }
}

impl Default for Type {
    fn default() -> Self { Type::Unknown }
}

#[derive(Debug, Default)]
pub struct TypeContext {
    bindings: HashMap<String, Type>,
}

impl TypeContext {
    pub fn new() -> Self { Self::default() }
    pub fn bind(&mut self, name: String, ty: Type) { self.bindings.insert(name, ty); }
    pub fn get(&self, name: &str) -> Option<&Type> { self.bindings.get(name) }
    pub fn get_or_unknown(&self, name: &str) -> Type {
        self.bindings.get(name).cloned().unwrap_or(Type::Unknown)
    }

    pub fn is_assignable(&self, from: &Type, to: &Type) -> bool {
        match (from, to) {
            (_, Type::Unknown) | (Type::Unknown, _) => true,
            (a, b) if a == b => true,
            (Type::Int, Type::Float) => true,
            (Type::Optional(inner), other) | (other, Type::Optional(inner)) => self.is_assignable(inner, other),
            (Type::List(a), Type::List(b)) => self.is_assignable(a, b),
            (Type::Dict(ak, av), Type::Dict(bk, bv)) => self.is_assignable(ak, bk) && self.is_assignable(av, bv),
            _ => false,
        }
    }
}
