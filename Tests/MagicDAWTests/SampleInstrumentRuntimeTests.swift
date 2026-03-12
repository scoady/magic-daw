import XCTest
@testable import MagicDAW

final class SampleInstrumentRuntimeTests: XCTestCase {
    func testMatchingRegionsRespectsNoteAndVelocity() {
        let soft = SampleZone(
            sampleFile: "samples/piano_C4_soft.wav",
            trigger: .attack,
            rootNote: 60,
            lowNote: 55,
            highNote: 66,
            lowVelocity: 0,
            highVelocity: 80,
            loopStart: nil,
            loopEnd: nil,
            tuning: 0.0
        )
        let hard = SampleZone(
            sampleFile: "samples/piano_C4_hard.wav",
            trigger: .attack,
            rootNote: 60,
            lowNote: 55,
            highNote: 66,
            lowVelocity: 81,
            highVelocity: 127,
            loopStart: nil,
            loopEnd: nil,
            tuning: 0.0
        )
        let instrument = LoadedInstrumentDefinition(
            definitionURL: URL(fileURLWithPath: "/tmp/Test.magicinstrument"),
            definition: InstrumentDefinition(name: "Test", type: .sampler),
            regions: [
                LoadedSampleRegion(sampleURL: URL(fileURLWithPath: "/tmp/soft.wav"), zone: soft),
                LoadedSampleRegion(sampleURL: URL(fileURLWithPath: "/tmp/hard.wav"), zone: hard),
            ]
        )

        XCTAssertEqual(instrument.matchingRegions(note: 60, velocity: 70).map(\.sampleURL.lastPathComponent), ["soft.wav"])
        XCTAssertEqual(instrument.matchingRegions(note: 60, velocity: 110).map(\.sampleURL.lastPathComponent), ["hard.wav"])
        XCTAssertTrue(instrument.matchingRegions(note: 72, velocity: 70).isEmpty)
    }

    func testRoundRobinSelectorRotatesThroughMatchingRegions() {
        let zoneA = SampleZone(
            sampleFile: "samples/snare_rr1.wav",
            trigger: .attack,
            rootNote: 38,
            lowNote: 38,
            highNote: 38,
            lowVelocity: 0,
            highVelocity: 127,
            loopStart: nil,
            loopEnd: nil,
            tuning: 0.0
        )
        let zoneB = SampleZone(
            sampleFile: "samples/snare_rr2.wav",
            trigger: .attack,
            rootNote: 38,
            lowNote: 38,
            highNote: 38,
            lowVelocity: 0,
            highVelocity: 127,
            loopStart: nil,
            loopEnd: nil,
            tuning: 0.0
        )
        let selector = RoundRobinSelector()
        let regions = [
            LoadedSampleRegion(sampleURL: URL(fileURLWithPath: "/tmp/snare_rr1.wav"), zone: zoneA),
            LoadedSampleRegion(sampleURL: URL(fileURLWithPath: "/tmp/snare_rr2.wav"), zone: zoneB),
        ]

        let first = selector.select(from: regions, enabled: true)
        let second = selector.select(from: regions, enabled: true)
        let third = selector.select(from: regions, enabled: true)

        XCTAssertEqual(first?.sampleURL.lastPathComponent, "snare_rr1.wav")
        XCTAssertEqual(second?.sampleURL.lastPathComponent, "snare_rr2.wav")
        XCTAssertEqual(third?.sampleURL.lastPathComponent, "snare_rr1.wav")
    }

    func testVoiceAllocatorPrefersIdleThenReleasedThenOldestVoice() {
        let allocator = VoiceAllocator(maxVoices: 2)

        let first = allocator.allocate(note: 60, at: 10)
        let second = allocator.allocate(note: 64, at: 20)
        XCTAssertNil(first.stolenVoiceIndex)
        XCTAssertNil(second.stolenVoiceIndex)

        let released = allocator.release(note: 60, at: 30)
        XCTAssertEqual(released, [first.voiceIndex])

        let third = allocator.allocate(note: 67, at: 40)
        XCTAssertEqual(third.voiceIndex, first.voiceIndex)
        XCTAssertEqual(third.stolenVoiceIndex, first.voiceIndex)

        let fourth = allocator.allocate(note: 69, at: 50)
        XCTAssertEqual(fourth.voiceIndex, second.voiceIndex)
        XCTAssertEqual(fourth.stolenVoiceIndex, second.voiceIndex)
    }

    func testMatchingRegionsCanTargetReleaseTriggerSeparately() {
        let attackZone = SampleZone(
            sampleFile: "samples/attack.wav",
            trigger: .attack,
            rootNote: 60,
            lowNote: 58,
            highNote: 62,
            lowVelocity: 0,
            highVelocity: 127,
            loopStart: nil,
            loopEnd: nil,
            tuning: 0.0
        )
        let releaseZone = SampleZone(
            sampleFile: "samples/release.wav",
            trigger: .release,
            rootNote: 60,
            lowNote: 58,
            highNote: 62,
            lowVelocity: 0,
            highVelocity: 127,
            loopStart: nil,
            loopEnd: nil,
            tuning: 0.0
        )
        let instrument = LoadedInstrumentDefinition(
            definitionURL: URL(fileURLWithPath: "/tmp/TriggerTest.magicinstrument"),
            definition: InstrumentDefinition(name: "TriggerTest", type: .sampler),
            regions: [
                LoadedSampleRegion(sampleURL: URL(fileURLWithPath: "/tmp/attack.wav"), zone: attackZone),
                LoadedSampleRegion(sampleURL: URL(fileURLWithPath: "/tmp/release.wav"), zone: releaseZone),
            ]
        )

        XCTAssertEqual(
            instrument.matchingRegions(note: 60, velocity: 100, trigger: .attack).map(\.sampleURL.lastPathComponent),
            ["attack.wav"]
        )
        XCTAssertEqual(
            instrument.matchingRegions(note: 60, velocity: 100, trigger: .release).map(\.sampleURL.lastPathComponent),
            ["release.wav"]
        )
    }

    func testSampleZoneDecodingDefaultsTriggerToAttackForOlderInstruments() throws {
        let json = """
        {
          "id": "11111111-1111-1111-1111-111111111111",
          "sampleFile": "samples/legacy.wav",
          "rootNote": 60,
          "lowNote": 60,
          "highNote": 60,
          "lowVelocity": 0,
          "highVelocity": 127,
          "loopStart": null,
          "loopEnd": null,
          "tuning": 0
        }
        """.data(using: .utf8)!

        let zone = try JSONDecoder().decode(SampleZone.self, from: json)
        XCTAssertEqual(zone.sampleFile, "samples/legacy.wav")
        XCTAssertEqual(zone.trigger, .attack)
    }
}
