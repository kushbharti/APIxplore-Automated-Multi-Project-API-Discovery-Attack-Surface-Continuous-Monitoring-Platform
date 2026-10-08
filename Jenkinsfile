pipeline {
    agent any

    options {
        timestamps()
    }

    stages {

        stage('Environment Check') {
            steps {
                echo 'Checking Jenkins environment...'

                bat 'python --version'
                bat 'git --version'
            }
        }

        stage('Create Virtual Environment') {
            steps {
                echo 'Creating Python virtual environment...'

                bat 'python -m venv .jenkins-venv'

                bat '.jenkins-venv\\Scripts\\python.exe --version'
            }
        }

        stage('Install Dependencies') {
            steps {
                echo 'Installing dependencies inside Jenkins virtual environment...'

                bat '.jenkins-venv\\Scripts\\python.exe -m pip install --upgrade pip'

                bat '.jenkins-venv\\Scripts\\python.exe -m pip install -r backend\\requirements.txt'
            }
        }

        stage('Automated Testing') {
            steps {
                echo 'Running Pytest inside Jenkins virtual environment...'

                bat '.jenkins-venv\\Scripts\\python.exe -m pytest -v backend\\test_simple.py --cov-fail-under=0'
            }
        }
    }

    post {

        success {
            echo 'APIxplore CI pipeline completed successfully.'
        }

        failure {
            echo 'APIxplore CI pipeline failed.'
        }

        always {
            echo 'Jenkins pipeline execution completed.'
        }
    }
}