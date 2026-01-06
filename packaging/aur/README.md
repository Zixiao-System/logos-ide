# AUR Package: logos-bin

This directory contains the PKGBUILD for publishing Logos to the Arch User Repository (AUR).

## First-time Setup

### 1. Create SSH Key for AUR

```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "your-email@example.com" -f ~/.ssh/aur

# Add to SSH agent
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/aur

# Configure SSH
cat >> ~/.ssh/config << EOF
Host aur.archlinux.org
  IdentityFile ~/.ssh/aur
  User aur
EOF
```

### 2. Add Public Key to AUR Account

1. Go to https://aur.archlinux.org/
2. Log in or create an account
3. Go to "My Account" → "SSH Public Keys"
4. Add the content of `~/.ssh/aur.pub`

### 3. Create the Package on AUR

```bash
# Clone the empty AUR repo (first time creates it)
git clone ssh://aur@aur.archlinux.org/logos-bin.git
cd logos-bin

# Copy files from this directory
cp /path/to/logos-ide/packaging/aur/PKGBUILD .
cp /path/to/logos-ide/packaging/aur/.SRCINFO .

# Update SHA256 checksum (after first release)
# Download the AppImage and run:
# sha256sum Logos-*.AppImage

# Commit and push
git add PKGBUILD .SRCINFO
git commit -m "Initial upload: logos-bin 2026.1.1"
git push
```

### 4. Add SSH Private Key to GitHub Secrets

1. Go to your GitHub repo → Settings → Secrets → Actions
2. Create new secret: `AUR_PUBLISH_SSH_KEY`
3. Paste the content of `~/.ssh/aur` (private key)

## Updating the Package

After the initial setup, the GitHub Actions workflow will automatically update the AUR package when you push a new tag.

## Testing Locally

```bash
# On Arch Linux
cd /path/to/logos-ide/packaging/aur
makepkg -si

# Or use an AUR helper
yay -S logos-bin
```

## Files

- `PKGBUILD` - The build script for the package
- `.SRCINFO` - Package metadata (auto-generated from PKGBUILD)

## Regenerating .SRCINFO

```bash
makepkg --printsrcinfo > .SRCINFO
```
