pipeline {
    agent { label 'macos' }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        disableConcurrentBuilds()
        timeout(time: 30, unit: 'MINUTES')
    }

    stages {
        stage('Tag') {
            steps {
                script {
                    env.BUILD_TAG_SHORT = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                    echo "Build tag: ${env.BUILD_TAG_SHORT}"
                }
            }
        }

        stage('Build & Package') {
            steps {
                sh 'make dmg'
            }
        }
    }

    post {
        success {
            archiveArtifacts artifacts: 'dist/*.dmg', fingerprint: true
            echo "Magic DAW build ${env.BUILD_TAG_SHORT} succeeded"
        }
        failure {
            echo "Magic DAW build ${env.BUILD_TAG_SHORT} failed"
        }
    }
}
