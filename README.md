# GentlyOS

**Version 0.1.0**

A lightweight, portable operating system based on Alpine Linux designed to run on bare metal, containers, VMs, and browsers.

## Vision

GentlyOS is designed from the ground up for maximum portability:
- **Bare Metal**: Boot on x86_64, ARM64, RISC-V
- **Containers**: Minimal OCI-compatible rootfs
- **Virtual Machines**: QEMU, KVM, Hyper-V ready
- **WebAssembly**: Browser-based via WebVM/CheerpX
- **Android**: proot-compatible for Termux

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    APPLICATIONS                             │
├─────────────────────────────────────────────────────────────┤
│                    USERSPACE SERVICES                       │
├─────────────────────────────────────────────────────────────┤
│              OPERATING SYSTEM ABSTRACTION LAYER             │
├──────────────┬──────────────┬──────────────┬───────────────┤
│  Bare Metal  │  Hypervisor  │  Container   │  WASM/Browser │
│    (HAL)     │   (virtio)   │   (OCI)      │  (emulated)   │
├──────────────┴──────────────┴──────────────┴───────────────┤
│                    HARDWARE / HOST                          │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
/core           - Kernel + essential drivers
/hal            - Hardware Abstraction Layer
/runtime        - Init system, service management
/userspace      - OS features and utilities
/targets        - Build configs per deployment type
  /metal        - Bare metal (x86, arm64, riscv)
  /vm           - QEMU/KVM/Hyper-V
  /container    - OCI rootfs
  /wasm         - WebVM-compatible build
  /android      - proot-compatible rootfs
```

## Building

```sh
# Clone Alpine aports
git clone --depth=1 https://gitlab.alpinelinux.org/alpine/aports.git

# Build GentlyOS image
./build.sh --target metal --arch x86_64
```

## License

MIT License

## Author

Zero2oneZ (tomlee3ddesign@gmail.com)
