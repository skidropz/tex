// Rebuild faithful animated WebPs from the bundled Yahoo! Messenger GIFs.
// Usage: swift scripts/build-emoticons-hd.swift assets/emoticons assets/emoticons/hd-candidate [happy sad ...]
// Uses macOS ImageIO/CoreGraphics and the installed libwebp img2webp utility.
import Foundation
import CoreGraphics
import CoreImage
import ImageIO
import UniformTypeIdentifiers

struct ConversionError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

func gifNumber(_ properties: [String: Any], _ key: String) -> Double? {
    (properties["{GIF}"] as? [String: Any])?[key].flatMap { ($0 as? NSNumber)?.doubleValue }
}

func convert(_ input: URL, to output: URL, scale: Int) throws {
    guard let source = CGImageSourceCreateWithURL(input as CFURL, nil),
          let first = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw ConversionError("Nu pot citi GIF-ul \(input.lastPathComponent)")
    }
    let count = CGImageSourceGetCount(source)
    let canvas = CGSize(width: first.width * scale, height: first.height * scale)
    let global = (CGImageSourceCopyProperties(source, nil) as? [String: Any]) ?? [:]
    let loop = Int(gifNumber(global, "LoopCount") ?? 0)
    let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("tex-emoji-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: scratch) }
    var arguments = ["img2webp", "-loop", String(loop)]
    var adjustedZeroDelays = 0
    let useLanczos = ProcessInfo.processInfo.environment["TEX_EMO_METHOD"] == "lanczos"
    let ciContext = useLanczos ? CIContext(options: [.useSoftwareRenderer: false]) : nil

    for index in 0..<count {
        guard let frame = CGImageSourceCreateImageAtIndex(source, index, nil),
              frame.width == first.width, frame.height == first.height else {
            throw ConversionError("Cadru lipsă sau incomplet în \(input.lastPathComponent), index \(index)")
        }
        let props = (CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [String: Any]) ?? [:]
        let seconds = gifNumber(props, "UnclampedDelayTime") ?? gifNumber(props, "DelayTime") ?? 0.1
        let rawDuration = Int((seconds * 1000).rounded())
        if rawDuration < 20 { adjustedZeroDelays += 1 }
        let duration = max(20, rawDuration) // Browserele nu afișează stabil cadre de 0–10 ms.
        // GIF-ul poate avea galben ascuns sub pixeli complet transparenți. Întâi îl
        // normalizăm la dimensiunea nativă în RGBA premultiplicat, apoi scalăm.
        let space = CGColorSpaceCreateDeviceRGB()
        let alpha = CGImageAlphaInfo.premultipliedLast.rawValue
        guard let native = CGContext(data: nil, width: first.width, height: first.height,
                                     bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: alpha),
              let context = CGContext(data: nil, width: Int(canvas.width), height: Int(canvas.height),
                                      bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: alpha) else {
            throw ConversionError("Nu pot aloca suprafața pentru \(input.lastPathComponent)")
        }
        native.interpolationQuality = .none
        native.draw(frame, in: CGRect(x: 0, y: 0, width: first.width, height: first.height))
        guard let normalized = native.makeImage() else { throw ConversionError("Nu pot normaliza cadrul \(index)") }
        let image: CGImage
        if useLanczos {
            guard let filter = CIFilter(name: "CILanczosScaleTransform") else { throw ConversionError("CILanczosScaleTransform lipsește") }
            filter.setValue(CIImage(cgImage: normalized), forKey: kCIInputImageKey)
            filter.setValue(scale, forKey: kCIInputScaleKey)
            filter.setValue(1, forKey: kCIInputAspectRatioKey)
            guard let result = filter.outputImage,
                  let rendered = ciContext?.createCGImage(result, from: CGRect(origin: .zero, size: canvas)) else {
                throw ConversionError("Nu pot scala Lanczos cadrul \(index) din \(input.lastPathComponent)")
            }
            image = rendered
        } else {
            context.interpolationQuality = .high
            context.draw(normalized, in: CGRect(origin: .zero, size: canvas))
            guard let rendered = context.makeImage() else { throw ConversionError("Nu pot scala cadrul \(index)") }
            image = rendered
        }
        let png = scratch.appendingPathComponent(String(format: "%04d.png", index))
        guard let destination = CGImageDestinationCreateWithURL(png as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw ConversionError("Nu pot crea PNG temporar")
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw ConversionError("Nu pot salva cadrul temporar") }
        if index == 0 && ProcessInfo.processInfo.environment["TEX_EMO_DEBUG_FRAMES"] == "1" {
            try FileManager.default.copyItem(at: png, to: output.deletingPathExtension().appendingPathExtension("frame0.png"))
        }
        arguments += ["-d", String(duration), "-lossless", "-exact", png.path]
    }
    arguments += ["-o", output.path]
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = arguments
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw ConversionError("img2webp a eșuat pentru \(input.lastPathComponent)") }
    let bytes = (try FileManager.default.attributesOfItem(atPath: output.path)[.size] as? NSNumber)?.intValue ?? 0
    print("\(input.deletingPathExtension().lastPathComponent): \(first.width)x\(first.height) → \(Int(canvas.width))x\(Int(canvas.height)), \(count) cadre, \(bytes) octeți, \(adjustedZeroDelays) durate minime")
}

let args = CommandLine.arguments
if args.count < 3 {
    fputs("Utilizare: swift scripts/build-emoticons-hd.swift <gif-dir> <output-dir> [nume ...]\n", stderr)
    exit(EXIT_FAILURE)
}
do {
    let inputDir = URL(fileURLWithPath: args[1], isDirectory: true)
    let outputDir = URL(fileURLWithPath: args[2], isDirectory: true)
    let names: [String] = args.count > 3 ? Array(args.dropFirst(3)) : try FileManager.default.contentsOfDirectory(atPath: inputDir.path)
        .filter { $0.hasSuffix(".gif") }.map { String($0.dropLast(4)) }.sorted()
    try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
    for name in names {
        guard name.range(of: "^[a-z0-9_-]+$", options: .regularExpression) != nil else { throw ConversionError("Nume invalid: \(name)") }
        let output = outputDir.appendingPathComponent(name + ".webp")
        guard !FileManager.default.fileExists(atPath: output.path) else { throw ConversionError("Fișierul există deja: \(output.path)") }
        try convert(inputDir.appendingPathComponent(name + ".gif"), to: output, scale: 8)
    }
} catch {
    fputs("Eroare: \(error)\n", stderr)
    exit(EXIT_FAILURE)
}
